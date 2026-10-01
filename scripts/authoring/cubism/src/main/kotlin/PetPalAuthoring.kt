// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 PetPal contributors. Original authoring client, 2026-10-01.
// Uses the public API of PSD2Live at 2ac751fbb3ffdc8251a82e0d600d97afafafcaac.
import io.github.psd2live.core.LayerClassificationOverride
import io.github.psd2live.core.LayerType
import io.github.psd2live.core.PSD2LivePipeline
import io.github.psd2live.core.PipelineConfig
import io.github.psd2live.core.ProgressListener
import io.github.psd2live.core.RigKeyformGeometryEdit
import io.github.psd2live.core.RigKeyformChannelsEdit
import io.github.psd2live.core.RigKeyformSetEdit
import io.github.psd2live.core.RigTargetKind
import io.github.psd2live.core.RigTargetRef
import io.github.psd2live.core.SemanticTag
import io.github.psd2live.core.TextureUpscaleConfig
import io.github.psd2live.i18n.AppLanguage
import io.github.psd2live.i18n.I18n
import org.umamo.runtime.model.Deformer
import org.umamo.runtime.model.KeyformCell
import org.umamo.runtime.model.KeyformGrid
import org.umamo.runtime.model.PuppetModel
import org.umamo.runtime.model.WarpLatticeForm
import java.nio.file.Files
import java.nio.file.Path
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

private val stableAngleWarpIds = setOf(
  "DeformFaceNinePose", "DeformFaceContour", "DeformEyeShapeR", "DeformEyeShapeL",
  "DeformBrowShapeR", "DeformBrowShapeL", "DeformNoseShapeBoth", "DeformMouthShapeBoth",
  "DeformIrisPreserveR", "DeformIrisPreserveL", "DeformHairFrontFollow", "DeformHairBackFollow",
)

private data class AnchoredHairSpec(val id: String, val rows: Int, val pinnedRows: Int, val swayPixels: Float, val liftPixels: Float)
private val anchoredHairSpecs = listOf(
  AnchoredHairSpec("DeformHairFrontPhysics", 4, 3, 6f, 0.8f),
  AnchoredHairSpec("DeformHairBackPhysics", 6, 4, 8f, 1f),
)

private fun <T> coordinate(grid: KeyformGrid<T>, cell: KeyformCell<T>): Map<String, Float> =
  grid.axes.mapIndexed { index, axis -> axis.parameterId.raw to axis.keys[cell.coordinate[index]] }.toMap()

private fun <T> neutralCell(grid: KeyformGrid<T>, model: PuppetModel): KeyformCell<T> =
  grid.cells.single { cell ->
    grid.axes.indices.all { index ->
      val axis = grid.axes[index]
      axis.keys[cell.coordinate[index]] == model.parameters.single { it.id == axis.parameterId }.default
    }
  }

/** Hair physics controls are UVs in the follow warp's frame. Its resting rectangle maps into
 * the pixel-space head container, so use both frames to recover the real displacement units. */
private fun hairFrameUnits(model: PuppetModel, deformer: Deformer.Warp): Pair<Float, Float> {
  val follow = model.deformers.single { it.id == deformer.parent } as Deformer.Warp
  val head = model.deformers.single { it.id == follow.parent } as Deformer.Warp
  require(head.id.raw == "DeformHeadContainer") { "Hair physics no longer maps through the expected head frame" }
  val headRest = neutralCell(requireNotNull(head.geometryGrid), model).form.controlPoints
  val followRest = neutralCell(requireNotNull(follow.geometryGrid), model).form.controlPoints
  val headRight = head.columns * 2
  val headBottom = head.rows * (head.columns + 1) * 2
  val headWidth = hypot(headRest[headRight] - headRest[0], headRest[headRight + 1] - headRest[1])
  val headHeight = hypot(headRest[headBottom] - headRest[0], headRest[headBottom + 1] - headRest[1])
  val followRight = follow.columns * 2
  val followBottom = follow.rows * (follow.columns + 1) * 2
  require(abs(followRest[followRight + 1] - followRest[1]) < 0.00001f && abs(followRest[followBottom] - followRest[0]) < 0.00001f) {
    "Hair follow neutral frame is no longer an axis-aligned rectangle"
  }
  val width = abs(followRest[followRight] - followRest[0]) * headWidth
  val height = abs(followRest[followBottom + 1] - followRest[1]) * headHeight
  require(width > 0f && height > 0f) { "Hair frame is degenerate" }
  return width to height
}

/** Keeps the generated local frames and parents. A neutral lattice is not necessarily UV identity:
 * the root and head-container controls are pixel coordinates, while descendants use parent UVs. */
private fun stablePortraitEdits(model: PuppetModel): List<RigKeyformSetEdit> {
  fun warp(id: String) = model.deformers.single { it.id.raw == id } as Deformer.Warp
  val body = warp("DeformBodyXY")
  val bodyNeutral = neutralCell(requireNotNull(body.geometryGrid), model).form.controlPoints
  val width = bodyNeutral.filterIndexed { i, _ -> i % 2 == 0 }.let { it.max() - it.min() }
  val height = bodyNeutral.filterIndexed { i, _ -> i % 2 == 1 }.let { it.max() - it.min() }
  require(width > 0f && height > 0f) { "Generated character frame is degenerate" }
  val edits = mutableListOf<RigKeyformSetEdit>()
  for (deformer in model.deformers.filterIsInstance<Deformer.Warp>()) {
    val id = deformer.id.raw
    if (id !in stableAngleWarpIds && id !in setOf("DeformBodyXY", "DeformBodyZBreath", "DeformHeadContainer")) continue
    val grid = requireNotNull(deformer.geometryGrid)
    val neutral = neutralCell(grid, model).form.controlPoints
    for (cell in grid.cells) {
      val values = coordinate(grid, cell)
      val points = neutral.copyOf()
      when (id) {
        "DeformBodyXY" -> {
          // Whole-character translation: the head cannot inherit a torso roll or nonuniform scale.
          val dx = values.getValue("ParamBodyAngleX") / 10f * 3f
          val dy = values.getValue("ParamBodyAngleY") / 10f * 1.5f
          for (i in points.indices step 2) { points[i] += dx; points[i + 1] += dy }
        }
        "DeformBodyZBreath" -> {
          // This child is in normalized body coordinates. Rotate in pixels, then normalize back;
          // rotating its UVs directly would shear a nonsquare portrait. Breathing is a small lift.
          val degrees = values.getValue("ParamBodyAngleZ") / 10f * 0.75f
          val radians = Math.toRadians(degrees.toDouble())
          val cosine = cos(radians).toFloat()
          val sine = sin(radians).toFloat()
          val lift = -values.getValue("ParamBreath") * 1.25f
          for (i in points.indices step 2) {
            val x = (neutral[i] - 0.5f) * width
            val y = (neutral[i + 1] - 0.78f) * height
            points[i] = 0.5f + (x * cosine - y * sine) / width
            points[i + 1] = 0.78f + (x * sine + y * cosine + lift) / height
          }
          // Avoid arithmetic roundoff at the exact rest key, including the exported neutral pose.
          if (degrees == 0f && lift == 0f) neutral.copyInto(points)
        }
        "DeformHeadContainer" -> {
          // Skin, features and hair all receive the same skull displacement, exactly once.
          val dx = values.getValue("ParamAngleX") / 45f * 3f
          val dy = -values.getValue("ParamAngleY") / 30f * 2.5f
          for (i in points.indices step 2) { points[i] += dx; points[i + 1] += dy }
        }
        // Independent face-surface, contour, feature and hair-perspective passes are neutralized.
        // Their parent still moves, and all original local rest-frame coordinates are retained.
        else -> Unit
      }
      edits += RigKeyformSetEdit(
        target = RigTargetRef(RigTargetKind.WARP_DEFORMER, id), coordinate = values,
        geometry = RigKeyformGeometryEdit(controlPoints = points.toList()),
      )
    }
  }
  require(model.deformers.map { it.id.raw }.containsAll(stableAngleWarpIds)) { "Unexpected stable-portrait rig layout" }
  for (spec in anchoredHairSpecs) {
    val hair = warp(spec.id)
    require(hair.rows == spec.rows && hair.columns == 3) { "Unexpected hair physics lattice dimensions" }
    val grid = requireNotNull(hair.geometryGrid)
    require(grid.axes.size == 1 && grid.axes.single().keys.contentEquals(floatArrayOf(-1f, 0f, 1f))) { "Unexpected hair physics axis" }
    val neutral = neutralCell(grid, model).form.controlPoints
    val (hairWidth, hairHeight) = hairFrameUnits(model, hair)
    for (cell in grid.cells) {
      val values = coordinate(grid, cell)
      val swing = values.values.single()
      val points = neutral.copyOf()
      // The original v^3 falloff only fixed the very top row. Its half-height row still moved
      // the bangs over the forehead. Pin the entire skull/fringe region and retain lower tips.
      for (r in spec.pinnedRows + 1..hair.rows) {
        val t = (r - spec.pinnedRows).toFloat() / (hair.rows - spec.pinnedRows)
        val weight = t * t * (3f - 2f * t)
        if (swing != 0f) for (c in 0..hair.columns) {
          val i = (r * (hair.columns + 1) + c) * 2
          points[i] += swing * spec.swayPixels / hairWidth * weight
          points[i + 1] -= swing * swing * spec.liftPixels / hairHeight * weight
        }
      }
      edits += RigKeyformSetEdit(
        target = RigTargetRef(RigTargetKind.WARP_DEFORMER, hair.id.raw), coordinate = values,
        geometry = RigKeyformGeometryEdit(controlPoints = points.toList()),
      )
    }
  }
  // Removing PhysicsEyeJelly alone does not remove the iris mesh's ParamEyeBallForm stretch:
  // expressions also write that parameter. Keep its keys but copy the neutral geometry to each.
  val irises = model.drawables.filter { it.id.raw in setOf("ArtMeshIridesR", "ArtMeshIridesL") }
  require(irises.size == 2) { "Expected two separately rigged irises" }
  for (iris in irises) {
    val grid = requireNotNull(iris.geometryGrid)
    require(grid.axes.map { it.parameterId.raw } == listOf("ParamEyeBallForm")) { "Unexpected iris geometry axes" }
    val neutral = neutralCell(grid, model).form.positionDeltas
    for (cell in grid.cells) edits += RigKeyformSetEdit(
      target = RigTargetRef(RigTargetKind.ART_MESH, iris.id.raw), coordinate = coordinate(grid, cell),
      geometry = RigKeyformGeometryEdit(positionDeltas = neutral.toList()),
    )
  }
  // Both original mouth illustrations already include their own outline. At rest only the
  // closed drawing is visible; the opening illustration fades in as its authored mesh unfolds.
  for (id in listOf("ArtMeshMouthOpen", "ArtMeshMouthClose")) {
    require(model.drawables.any { it.id.raw == id }) { "Original mouth drawing missing: $id" }
    for ((open, opacity) in listOf(0f to 0f, 0.18f to 1f, 1f to 1f)) {
      edits += RigKeyformSetEdit(
        target = RigTargetRef(RigTargetKind.ART_MESH, id),
        coordinate = mapOf("ParamMouthOpenY" to open),
        channels = RigKeyformChannelsEdit(opacity = if (id == "ArtMeshMouthOpen") opacity else 1f - opacity),
      )
    }
  }
  return edits
}

private fun assertRigidLattice(deformer: Deformer.Warp, model: PuppetModel, unitX: Float, unitY: Float) {
  val grid = requireNotNull(deformer.geometryGrid)
  val neutral = neutralCell(grid, model).form.controlPoints
  val right = deformer.columns * 2
  val bottom = deformer.rows * (deformer.columns + 1) * 2
  fun distance(points: FloatArray, a: Int, b: Int) =
    hypot((points[a] - points[b]) * unitX, (points[a + 1] - points[b + 1]) * unitY)
  for (cell in grid.cells) {
    val points = cell.form.controlPoints
    for (r in 0..deformer.rows) for (c in 0..deformer.columns) {
      val i = (r * (deformer.columns + 1) + c) * 2
      val u = c.toFloat() / deformer.columns
      val v = r.toFloat() / deformer.rows
      for (axis in 0..1) {
        val predicted = points[axis] + u * (points[right + axis] - points[axis]) + v * (points[bottom + axis] - points[axis])
        val unit = if (axis == 0) unitX else unitY
        require(abs(points[i + axis] - predicted) * unit <= 0.005f) { "Non-affine stable lattice: ${deformer.id.raw}" }
      }
    }
    for (corner in listOf(right, bottom, bottom + right)) {
      val before = distance(neutral, 0, corner)
      require(abs(distance(points, 0, corner) - before) <= max(0.005f, before * 0.00001f)) {
        "Stable lattice stretches its rest frame: ${deformer.id.raw}"
      }
    }
  }
}

private fun assertStablePortrait(original: PuppetModel, exported: PuppetModel) {
  for (deformer in original.deformers) {
    val next = exported.deformers.single { it.id == deformer.id }
    require(next.parent == deformer.parent) { "Stable profile must not reparent a local frame" }
    if (deformer is Deformer.Warp && next is Deformer.Warp) {
      val before = neutralCell(requireNotNull(deformer.geometryGrid), original).form.controlPoints
      val nextGrid = requireNotNull(next.geometryGrid)
      val after = neutralCell(nextGrid, exported).form.controlPoints
      require(before.contentEquals(after)) { "Stable profile changed neutral lattice ${deformer.id.raw}" }
      if (deformer.id.raw in stableAngleWarpIds) require(nextGrid.cells.all { it.form.controlPoints.contentEquals(before) }) {
        "Independent angle deformation survived: ${deformer.id.raw}"
      }
    }
  }
  val root = exported.deformers.single { it.id.raw == "DeformBodyXY" } as Deformer.Warp
  val rest = neutralCell(requireNotNull(root.geometryGrid), exported).form.controlPoints
  val width = rest.filterIndexed { i, _ -> i % 2 == 0 }.let { it.max() - it.min() }
  val height = rest.filterIndexed { i, _ -> i % 2 == 1 }.let { it.max() - it.min() }
  assertRigidLattice(root, exported, 1f, 1f)
  assertRigidLattice(exported.deformers.single { it.id.raw == "DeformBodyZBreath" } as Deformer.Warp, exported, width, height)
  assertRigidLattice(exported.deformers.single { it.id.raw == "DeformHeadContainer" } as Deformer.Warp, exported, 1f, 1f)
  for (spec in anchoredHairSpecs) {
    val hair = exported.deformers.single { it.id.raw == spec.id } as Deformer.Warp
    val grid = requireNotNull(hair.geometryGrid)
    val neutral = neutralCell(grid, exported).form.controlPoints
    val (hairWidth, hairHeight) = hairFrameUnits(exported, hair)
    for (cell in grid.cells) {
      val points = cell.form.controlPoints
      val swing = coordinate(grid, cell).values.single()
      val pinnedSize = (spec.pinnedRows + 1) * (hair.columns + 1) * 2
      require((0 until pinnedSize).all { points[it] == neutral[it] }) { "Hair crown or forehead moved: ${spec.id}" }
      for (i in points.indices step 2) {
        require(abs(points[i] - neutral[i]) * hairWidth <= spec.swayPixels + 0.005f &&
          abs(points[i + 1] - neutral[i + 1]) * hairHeight <= spec.liftPixels + 0.005f) { "Hair tip exceeds its authored pixel budget" }
      }
      val bottom = hair.rows * (hair.columns + 1) * 2
      require(abs((points[bottom] - neutral[bottom]) * hairWidth - swing * spec.swayPixels) <= 0.005f) { "Hair tip animation was not retained" }
      require(abs((points[bottom + 1] - neutral[bottom + 1]) * hairHeight + swing * swing * spec.liftPixels) <= 0.005f) { "Hair tip lift was not retained" }
    }
  }
  for (drawable in original.drawables) {
    val next = exported.drawables.single { it.id == drawable.id }
    require(next.parentDeformerId == drawable.parentDeformerId) { "Stable profile changed a drawable parent" }
    val before = drawable.geometryGrid ?: continue
    val after = requireNotNull(next.geometryGrid)
    require(neutralCell(before, original).form.positionDeltas.contentEquals(neutralCell(after, exported).form.positionDeltas)) {
      "Stable profile changed neutral drawable ${drawable.id.raw}"
    }
    if (drawable.id.raw in setOf("ArtMeshIridesR", "ArtMeshIridesL")) {
      val restDeltas = neutralCell(before, original).form.positionDeltas
      require(after.cells.all { it.form.positionDeltas.contentEquals(restDeltas) }) { "Iris jelly geometry survived" }
    } else {
      require(before.axes.size == after.axes.size && before.cells.size == after.cells.size)
      for (cell in before.cells) require(after.cells.single { it.coordinate.contentEquals(cell.coordinate) }.form.positionDeltas.contentEquals(cell.form.positionDeltas)) {
        "Stable profile changed normal blink, brow, or mouth mesh keys: ${drawable.id.raw}"
      }
    }
  }
}

// Independent authoring client for the frozen GPL tool. It is never part of the PetPal application.
fun main(arguments: Array<String>) {
  require(arguments.size in 2..3) { "Usage: <layered-PSD> <local-output-directory> [classic|continuous-body|stable-portrait]" }
  val profile = arguments.getOrElse(2) { "classic" }
  require(profile in setOf("classic", "continuous-body", "stable-portrait")) { "Unknown authoring profile: $profile" }
  val stablePortrait = profile == "stable-portrait"
  val continuousBody = profile in setOf("continuous-body", "stable-portrait")
  I18n.setLanguage(AppLanguage.ENGLISH, persist = false)
  val input = Path.of(arguments[0]).toAbsolutePath().normalize()
  val output = Path.of(arguments[1]).toAbsolutePath().normalize()
  val projectRoot = Path.of(requireNotNull(System.getProperty("petpal.authoring.projectRoot")) {
    "Use scripts/authoring/Build-AkariCubism.ps1 to supply the actual project root"
  }).toAbsolutePath().normalize()
  require(input.startsWith(projectRoot) && output.startsWith(projectRoot)) { "Authoring paths must remain inside PetPal" }
  require(Files.isRegularFile(input) && input.toString().endsWith(".psd")) { "A real layered PSD is required" }
  val initialConfig = PipelineConfig(
    atlasSize = 2048, meshSpacing = 48,
    headTurnStrength = if (continuousBody) 0.25f else 0.55f,
    bodyStrength = if (continuousBody) 0.30f else 0.65f,
    textureUpscale = TextureUpscaleConfig(scale = 1),
    physicsEyeJelly = !stablePortrait,
    mouthOutlineEnabled = !stablePortrait,
  )
  val pipeline = PSD2LivePipeline()
  val inspected = pipeline.inspect(input, initialConfig)
  if (continuousBody) {
    val bodyLayers = inspected.layers.filter { it.source.name.trim().equals("topwear", ignoreCase = true) }
    require(bodyLayers.size == 1 && bodyLayers.single().opaquePixels > 0) {
      "The continuous-body profile requires one usable topwear layer containing the connected neck and body"
    }
    require(inspected.layers.none { it.source.name.trim().equals("neck", ignoreCase = true) }) {
      "The continuous-body profile must not contain a separate neck layer"
    }
  }
  val requiredBindings = mapOf("blush" to "ParamCheek", "tears" to "ParamTear")
  val overrides = requiredBindings.flatMap { (sourceName, parameter) ->
    val matches = inspected.layers.filter { it.source.name.trim().equals(sourceName, ignoreCase = true) }
    require(matches.isNotEmpty()) { "Required original source layer missing: $sourceName" }
    require(matches.all { it.opaquePixels > 0 }) { "Source layer has no usable pixels: $sourceName" }
    matches.map { layer ->
      println("Binding ${layer.source.id.raw} (${layer.source.name}) -> $parameter opacity 0..1")
      layer.source.id.raw to LayerClassificationOverride(
        type = LayerType.TOGGLE, tag = SemanticTag.FACE_DETAIL, parameter = parameter,
      )
    }
  }.toMap()
  val boundConfig = initialConfig.copy(layerOverrides = overrides)
  var stableBaseline: PuppetModel? = null
  val exportConfig = if (continuousBody) {
    // Reinspect with the same classifications that run() will use. Reusing the earlier analysis
    // with new overrides would leave its semantic tags out of sync with the export configuration.
    val preview = pipeline.buildPreview(input, boundConfig)
    if (stablePortrait) stableBaseline = preview.rig.puppet
    val rotation = preview.rig.puppet.deformers.single { it.id.raw == "DeformHeadRotation" } as Deformer.Rotation
    val grid = requireNotNull(rotation.geometryGrid) { "Generated head rotation keyforms are missing" }
    val axis = grid.axes.single()
    require(axis.parameterId.raw == "ParamAngleZ" && axis.keys.contentEquals(floatArrayOf(-30f, 0f, 30f))) {
      "Unexpected generated head rotation axis"
    }
    val rotationCorrections = grid.cells.map { cell ->
      require(cell.coordinate.size == 1) { "Unexpected head rotation keyform coordinate" }
      val form = cell.form
      val key = axis.keys[cell.coordinate.single()]
      require(key != 0f || form.angle == 0f) { "Neutral head rotation must remain unchanged" }
      RigKeyformSetEdit(
        target = RigTargetRef(RigTargetKind.ROTATION_DEFORMER, rotation.id.raw),
        coordinate = mapOf(axis.parameterId.raw to key),
        geometry = RigKeyformGeometryEdit(
          originX = form.originX, originY = form.originY, angle = form.angle * if (stablePortrait) 0.10f else 0.20f, scale = form.scale,
        ),
      )
    }
    val corrections = rotationCorrections + if (stablePortrait) stablePortraitEdits(preview.rig.puppet) else emptyList()
    boundConfig.copy(rigEdits = boundConfig.rigEdits.copy(keyformSetEdits = corrections))
  } else boundConfig
  val result = pipeline.run(input, output, exportConfig, ProgressListener { stage, fraction ->
    println("%3d%%  %s".format((fraction * 100).toInt(), stage))
  })
  val model = result.previewModel.rig.puppet
  for (id in requiredBindings.values) {
    require(model.parameters.any { it.id.raw == id && it.min == 0f && it.max == 1f && it.default == 0f }) {
      "Generated parameter range/default mismatch: $id"
    }
  }
  if (continuousBody) {
    val rotation = model.deformers.single { it.id.raw == "DeformHeadRotation" } as Deformer.Rotation
    val grid = requireNotNull(rotation.geometryGrid)
    val maxAngle = if (stablePortrait) 3.0001f else 6.0001f
    require(grid.cells.all { kotlin.math.abs(it.form.angle) <= maxAngle }) { "Head rotation attenuation was not retained" }
    val axis = grid.axes.single()
    require(grid.cells.single { axis.keys[it.coordinate.single()] == 0f }.form.angle == 0f) {
      "Neutral head rotation changed during export"
    }
  }
  if (stablePortrait) {
    assertStablePortrait(requireNotNull(stableBaseline), model)
    println("Stable portrait: neutral frames and parents retained; rigid body/head lattices; no independent face/hair perspective or iris jelly; anchored crown/fringe with 6px front and 8px rear tips; original blink and mouth keys retained")
  }
  println("Exported ${result.exportedFiles.size} files; ${model.parameters.size} parameters; ${model.drawables.size} drawables; profile=$profile")
  result.warnings.forEach { System.err.println("Warning: $it") }
}
