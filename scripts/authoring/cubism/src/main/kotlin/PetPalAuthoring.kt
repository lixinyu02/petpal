// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 PetPal contributors. Original authoring client, 2026-10-01.
// Uses the public API of PSD2Live at 2ac751fbb3ffdc8251a82e0d600d97afafafcaac.
import io.github.psd2live.core.LayerClassificationOverride
import io.github.psd2live.core.ClassifiedLayer
import io.github.psd2live.core.LayerType
import io.github.psd2live.core.MeshSettings
import io.github.psd2live.core.PSD2LivePipeline
import io.github.psd2live.core.PipelineConfig
import io.github.psd2live.core.ProgressListener
import io.github.psd2live.core.RigKeyformGeometryEdit
import io.github.psd2live.core.RigKeyformChannelsEdit
import io.github.psd2live.core.RigKeyformSetEdit
import io.github.psd2live.core.RigParameterEdit
import io.github.psd2live.core.RigTargetKind
import io.github.psd2live.core.RigTargetRef
import io.github.psd2live.core.RigWarpEdit
import io.github.psd2live.core.SemanticTag
import io.github.psd2live.core.TextureUpscaleConfig
import io.github.psd2live.i18n.AppLanguage
import io.github.psd2live.i18n.I18n
import org.umamo.runtime.model.Deformer
import org.umamo.runtime.model.ChannelValue
import org.umamo.runtime.model.FormChannel
import org.umamo.runtime.model.KeyformCell
import org.umamo.runtime.model.KeyformGrid
import org.umamo.runtime.model.PuppetModel
import org.umamo.runtime.model.WarpLatticeForm
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
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

private val referencePatchBindings = linkedMapOf(
  "blink-left" to "ParamEyeLOpen", "blink-right" to "ParamEyeROpen",
  "mouth-a" to "ParamMouthA", "mouth-o" to "ParamMouthO",
  "warm" to "ParamWarm", "sad" to "ParamSad", "pout" to "ParamPout",
  "shy" to "ParamShy", "surprise" to "ParamSurprise", "relaxed" to "ParamRelaxed",
)
private val referenceOriginalEmotions = setOf("warm", "sad", "pout")
private val referenceNewEmotions = setOf("shy", "surprise", "relaxed")
private val referenceRequiredLayers = setOf("topwear", "face", "front hair 1", "front hair 2", "blink-left", "blink-right", "mouth-a", "mouth-o")
private val referenceUnusedParameters = setOf("ParamEyeBallX", "ParamEyeBallY", "ParamEyeBallForm", "ParamBrowLY", "ParamBrowRY", "ParamMouthForm", "ParamHairBack")
private val referenceStandardBindings = setOf("ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamBodyAngleX", "ParamBodyAngleY", "ParamBodyAngleZ", "ParamEyeLOpen", "ParamEyeROpen", "ParamMouthOpenY", "ParamBreath", "ParamHairFront")
private val referenceGestureParameters = listOf(
  RigParameterEdit("ParamHandsLift", "Clasped hands: gentle lift", 0f, 1f, 0f, created = true),
  RigParameterEdit("ParamHandsSway", "Clasped hands: small shared sway", -1f, 1f, 0f, created = true),
  RigParameterEdit("ParamSleeveEase", "Sleeves: gentle ease", 0f, 1f, 0f, created = true),
)
private val referenceGestureIds = referenceGestureParameters.map { it.id }.toSet()
private val referenceFeatureLayers = setOf("eyebrow-right", "eyebrow-left", "eye-white-right", "eye-white-left", "iris-right", "iris-left", "eyelash-upper-right", "eyelash-upper-left", "eyelash-lower-right", "eyelash-lower-left")
private val referenceFeatureBaseLayers = setOf("topwear", "face", "front hair 1", "front hair 2", "mouth-a", "mouth-o")
private val referenceFeatureParameters = listOf(
  RigParameterEdit("ParamEyeBallX", "Independent iris gaze X", -1f, 1f, 0f),
  RigParameterEdit("ParamEyeBallY", "Independent iris gaze Y", -1f, 1f, 0f),
  RigParameterEdit("ParamBrowLY", "Left eyebrow height", -1f, 1f, 0f),
  RigParameterEdit("ParamBrowRY", "Right eyebrow height", -1f, 1f, 0f),
  RigParameterEdit("ParamBrowLAngle", "Left eyebrow angle", -1f, 1f, 0f, created = true),
  RigParameterEdit("ParamBrowRAngle", "Right eyebrow angle", -1f, 1f, 0f, created = true),
)
private val referenceFeatureIds = referenceFeatureParameters.map { it.id }.toSet()

private data class ReferenceFrame(val left: Float, val top: Float, val width: Float, val height: Float)
private fun referenceRootFrame(model: PuppetModel): ReferenceFrame {
  val root = model.deformers.single { it.id.raw == "DeformBodyXY" } as Deformer.Warp
  val points = neutralCell(requireNotNull(root.geometryGrid), model).form.controlPoints
  return ReferenceFrame(points[0], points[1], points[root.columns * 2] - points[0], points[root.rows * (root.columns + 1) * 2 + 1] - points[1])
}
private fun referenceHeadFrame(model: PuppetModel): ReferenceFrame {
  val root = referenceRootFrame(model)
  val rotation = model.deformers.single { it.id.raw == "DeformHeadRotation" } as Deformer.Rotation
  require(abs(rotation.baseAngle) < 0.00001f) { "Reference pixels require an upright, unrotated source calibration" }
  val pivot = neutralCell(requireNotNull(rotation.geometryGrid), model).form
  val head = model.deformers.single { it.id.raw == "DeformHeadContainer" } as Deformer.Warp
  val points = neutralCell(requireNotNull(head.geometryGrid), model).form.controlPoints
  return ReferenceFrame(
    root.left + pivot.originX * root.width + points[0], root.top + pivot.originY * root.height + points[1],
    points[head.columns * 2] - points[0], points[head.rows * (head.columns + 1) * 2 + 1] - points[1],
  )
}
private fun smoothReference(value: Float): Float = value.coerceIn(0f, 1f).let { it * it * (3f - 2f * it) }
private fun referenceMask(value: Float, outerStart: Float, innerStart: Float, innerEnd: Float, outerEnd: Float): Float =
  smoothReference((value - outerStart) / (innerStart - outerStart)) * smoothReference((outerEnd - value) / (outerEnd - innerEnd))

/** V8 retains the original clasped-hands artwork. One translation moves BOTH hands, including
 * their contact and all fingers; this is not separate finger/arm rigging or a raised-hand pose.
 * The flat region extends beyond the visible hands so triangles crossing their outline stay
 * rigid too. Only clothing below the fixed shoulder line absorbs the smooth transition. */
private fun referenceGestureEdits(model: PuppetModel): List<RigKeyformSetEdit> {
  val bodyFrame = referenceRootFrame(model)
  val body = model.drawables.single { it.name.trim().lowercase() == "topwear" }
  require(body.parentDeformerId?.raw == "DeformReferenceBody") { "Gesture mesh left the original body frame" }
  val mesh = requireNotNull(body.mesh)
  val canvas = FloatArray(mesh.positions.size) { i ->
    if (i % 2 == 0) bodyFrame.left + mesh.positions[i] * bodyFrame.width else bodyFrame.top + mesh.positions[i] * bodyFrame.height
  }
  // Mesh fill can bridge a soft silhouette or an otherwise sparse area with triangles larger
  // than the nominal interior spacing. Protect whole triangles touching the observed hand
  // rectangle; protecting only their inner vertices would still shear pixels between them.
  val handTriangleVertices = mutableSetOf<Int>()
  for (triangle in mesh.indices.indices step 3) {
    val vertices = listOf(mesh.indices[triangle] * 2, mesh.indices[triangle + 1] * 2, mesh.indices[triangle + 2] * 2)
    if (vertices.maxOf { canvas[it] } >= 340f && vertices.minOf { canvas[it] } <= 692f &&
      vertices.maxOf { canvas[it + 1] } >= 1270f && vertices.minOf { canvas[it + 1] } <= 1455f) handTriangleVertices.addAll(vertices)
  }
  require(handTriangleVertices.isNotEmpty()) { "Gesture mesh does not cover the original hands" }
  val rigidLeft = minOf(300f, handTriangleVertices.minOf { canvas[it] } - 2f)
  val rigidRight = maxOf(724f, handTriangleVertices.maxOf { canvas[it] } + 2f)
  val rigidTop = minOf(1225f, handTriangleVertices.minOf { canvas[it + 1] } - 2f)
  val rigidBottom = maxOf(1485f, handTriangleVertices.maxOf { canvas[it + 1] } + 2f)
  require(rigidLeft >= 150f && rigidRight <= 875f && rigidTop >= 1100f && rigidBottom <= 1538f) { "Topwear triangulation reaches too far from the hands; refine it before adding gestures" }
  println("Gesture shared-hand triangle coverage: ${handTriangleVertices.size} vertices, rigid bounds [$rigidLeft,$rigidTop,$rigidRight,$rigidBottom]")
  val edits = mutableListOf<RigKeyformSetEdit>()
  for (lift in listOf(0f, 0.5f, 1f)) for (sway in listOf(-1f, 0f, 1f)) for (ease in listOf(0f, 0.5f, 1f)) {
    val deltas = FloatArray(mesh.positions.size)
    for (i in mesh.positions.indices step 2) {
      val x = canvas[i]
      val y = canvas[i + 1]
      // The V7 body warp already fixes y<=860. Keep an additional 60px buffer before any
      // new geometry moves, rather than hoping sparse triangle interpolation pins the collar.
      if (y <= 920f) continue
      val hands = referenceMask(x, 80f, rigidLeft, rigidRight, 944f) * referenceMask(y, 920f, rigidTop, rigidBottom, 1630f)
      val sleeveY = referenceMask(y, 920f, 1030f, 1250f, 1400f)
      val sleeveLeft = referenceMask(x, 80f, 145f, 270f, 360f)
      val sleeveRight = referenceMask(x, 664f, 754f, 879f, 944f)
      // Suppression inside the shared hand region prevents sleeve easing from changing the
      // spacing between the two hands. The two outer sleeves ease inward by at most 3px.
      val sleeve = (sleeveLeft - sleeveRight) * sleeveY * (1f - hands)
      deltas[i] = (6f * sway * hands + 3f * ease * sleeve) / bodyFrame.width
      deltas[i + 1] = -16f * lift * hands / bodyFrame.height
    }
    edits += RigKeyformSetEdit(
      RigTargetRef(RigTargetKind.ART_MESH, body.id.raw),
      mapOf("ParamHandsLift" to lift, "ParamHandsSway" to sway, "ParamSleeveEase" to ease),
      geometry = RigKeyformGeometryEdit(positionDeltas = deltas.toList()),
    )
  }
  return edits
}

/** Original pixels are the rest pose. Head, body and hair have separate, bounded children;
 * the generated face/feature warps never independently tug the baked facial illustration. */
private fun referenceLayeredEdits(model: PuppetModel): List<RigKeyformSetEdit> {
  val edits = mutableListOf<RigKeyformSetEdit>()
  val headFrame = referenceHeadFrame(model)
  val bodyFrame = referenceRootFrame(model)
  for (deformer in model.deformers) when (deformer) {
    is Deformer.Warp -> {
      if (deformer.id.raw in setOf("DeformReferenceHead", "DeformReferenceBody", "DeformHairFrontPhysics")) continue
      val grid = requireNotNull(deformer.geometryGrid)
      val neutral = neutralCell(grid, model).form.controlPoints
      for (cell in grid.cells) edits += RigKeyformSetEdit(
        RigTargetRef(RigTargetKind.WARP_DEFORMER, deformer.id.raw), coordinate(grid, cell),
        geometry = RigKeyformGeometryEdit(controlPoints = neutral.toList()),
      )
    }
    is Deformer.Rotation -> {
      val grid = requireNotNull(deformer.geometryGrid)
      val neutral = neutralCell(grid, model).form
      for (cell in grid.cells) edits += RigKeyformSetEdit(
        RigTargetRef(RigTargetKind.ROTATION_DEFORMER, deformer.id.raw), coordinate(grid, cell),
        geometry = RigKeyformGeometryEdit(originX = neutral.originX, originY = neutral.originY, angle = neutral.angle, scale = neutral.scale),
      )
    }
  }
  val head = model.deformers.single { it.id.raw == "DeformReferenceHead" } as Deformer.Warp
  val headRest = neutralCell(requireNotNull(head.geometryGrid), model).form.controlPoints
  // A fixed control at y=680 alone is insufficient: vertices in the boundary cell interpolate
  // with the previous, moving row. Finish the taper at the last lattice knot BEFORE 680 so both
  // rows of every cell that can contain the neck are fixed in the exported Core geometry.
  val headKnots = (0..head.rows).map { r -> headFrame.top + headRest[r * (head.columns + 1) * 2 + 1] * headFrame.height }
  // Protect the opposite end of the interpolation cell as well: a taper starting at 620 would
  // already affect pixels below the preceding lattice knot. The tiny canvas/Core bake margin is
  // intentional, and leaves both vertices of every cell intersecting y<=620 fully rigid.
  val rigidHeadEnd = headKnots.first { it >= 622f }
  val fixedHeadStart = headKnots.last { it <= 678f }
  require(fixedHeadStart > rigidHeadEnd) { "Reference head lattice cannot separate face and neck; refine it" }
  // The upper face moves as one small rigid drawing. The neck/shoulder overlap remains fixed;
  // use a refined child lattice so the smooth transition begins BELOW all facial features.
  for (x in listOf(-45f, 0f, 45f)) for (y in listOf(-30f, 0f, 30f)) for (z in listOf(-30f, 0f, 30f)) {
    val degrees = x / 45f * 0.45f + y / 30f * 0.25f + z / 30f * 1.1f
    val radians = Math.toRadians(degrees.toDouble())
    val cosine = cos(radians).toFloat(); val sine = sin(radians).toFloat()
    val points = headRest.copyOf()
    if (degrees != 0f) for (i in points.indices step 2) {
      val canvasX = headFrame.left + headRest[i] * headFrame.width
      val canvasY = headFrame.top + headRest[i + 1] * headFrame.height
      val weight = 1f - smoothReference((canvasY - rigidHeadEnd) / (fixedHeadStart - rigidHeadEnd))
      val px = canvasX - 512f; val py = canvasY - 670f
      points[i] += (px * cosine - py * sine - px) / headFrame.width * weight
      points[i + 1] += (px * sine + py * cosine - py) / headFrame.height * weight
    }
    edits += RigKeyformSetEdit(
      RigTargetRef(RigTargetKind.WARP_DEFORMER, head.id.raw), mapOf("ParamAngleX" to x, "ParamAngleY" to y, "ParamAngleZ" to z),
      geometry = RigKeyformGeometryEdit(controlPoints = points.toList()),
    )
  }
  val body = model.deformers.single { it.id.raw == "DeformReferenceBody" } as Deformer.Warp
  val bodyRest = neutralCell(requireNotNull(body.geometryGrid), model).form.controlPoints
  val fixedBodyEnd = (0..body.rows).map { r -> bodyFrame.top + bodyRest[r * (body.columns + 1) * 2 + 1] * bodyFrame.height }.first { it >= 860f }
  for (x in listOf(-10f, 0f, 10f)) for (y in listOf(-10f, 0f, 10f)) for (z in listOf(-10f, 0f, 10f)) for (breath in listOf(0f, 0.5f, 1f)) {
    val points = bodyRest.copyOf()
    for (i in points.indices step 2) {
      val canvasY = bodyFrame.top + bodyRest[i + 1] * bodyFrame.height
      val weight = smoothReference((canvasY - fixedBodyEnd) / 260f)
      points[i] += (x / 10f * 1.2f + z / 10f * 1f) / bodyFrame.width * weight
      points[i + 1] += (y / 10f * 0.6f - breath * 1.25f) / bodyFrame.height * weight
    }
    edits += RigKeyformSetEdit(
      RigTargetRef(RigTargetKind.WARP_DEFORMER, body.id.raw), mapOf("ParamBodyAngleX" to x, "ParamBodyAngleY" to y, "ParamBodyAngleZ" to z, "ParamBreath" to breath),
      geometry = RigKeyformGeometryEdit(controlPoints = points.toList()),
    )
  }
  val hair = model.deformers.single { it.id.raw == "DeformHairFrontPhysics" } as Deformer.Warp
  val hairGrid = requireNotNull(hair.geometryGrid)
  val hairRest = neutralCell(hairGrid, model).form.controlPoints
  val follow = model.deformers.single { it.id == hair.parent } as Deformer.Warp
  val followRest = neutralCell(requireNotNull(follow.geometryGrid), model).form.controlPoints
  val hairWidth = (followRest[follow.columns * 2] - followRest[0]) * headFrame.width
  val hairHeight = (followRest[follow.rows * (follow.columns + 1) * 2 + 1] - followRest[1]) * headFrame.height
  require(hairWidth > 0f && hairHeight > 0f && hair.rows == 4) { "Reference hair frame changed" }
  for (cell in hairGrid.cells) {
    val values = coordinate(hairGrid, cell); val swing = values.getValue("ParamHairFront")
    val points = hairRest.copyOf()
    for (r in 3..hair.rows) for (c in 0..hair.columns) {
      val weight = smoothReference((r - 2).toFloat() / (hair.rows - 2))
      val i = (r * (hair.columns + 1) + c) * 2
      points[i] += swing * 1.25f / hairWidth * weight
      points[i + 1] -= swing * swing * 0.15f / hairHeight * weight
    }
    edits += RigKeyformSetEdit(RigTargetRef(RigTargetKind.WARP_DEFORMER, hair.id.raw), values, geometry = RigKeyformGeometryEdit(controlPoints = points.toList()))
  }
  for ((name, parameter) in referencePatchBindings) {
    val drawable = model.drawables.singleOrNull { it.name.trim().lowercase() == name } ?: continue
    val keys = when {
      name.startsWith("blink-") -> listOf(0f to 1f, 0.60f to 1f, 0.62f to 0f, 1f to 0f)
      name.startsWith("mouth-") -> listOf(0f to 0f, 0.08f to 1f, 1f to 1f)
      else -> listOf(0f to 0f, 1f to 1f)
    }
    for ((value, opacity) in keys) edits += RigKeyformSetEdit(
      RigTargetRef(RigTargetKind.ART_MESH, drawable.id.raw), mapOf(parameter to value), channels = RigKeyformChannelsEdit(opacity = opacity),
    )
    if (!name.startsWith("mouth-")) continue
    val mesh = requireNotNull(drawable.mesh)
    for (open in listOf(0f, 0.4f, 1f)) {
      val deltas = FloatArray(mesh.positions.size)
      for (i in mesh.positions.indices step 2) {
        val px = headFrame.left + mesh.positions[i] * headFrame.width
        val py = headFrame.top + mesh.positions[i + 1] * headFrame.height
        val weight = referenceMask(px, 474f, 482f, 553f, 562f) * referenceMask(py, 465f, 475f, 515f, 529f)
        // Leave a small bake margin: the official Core's pixel reconstruction is slightly larger
        // than the preview frame. The final Core contract stays at <=12px, including that scale.
        deltas[i + 1] = ((py - 490f) * (0.45f + open * 0.55f - 1f) * weight).coerceIn(-11.8f, 11.8f) / headFrame.height
      }
      edits += RigKeyformSetEdit(RigTargetRef(RigTargetKind.ART_MESH, drawable.id.raw), mapOf("ParamMouthOpenY" to open), geometry = RigKeyformGeometryEdit(positionDeltas = deltas.toList()))
    }
  }
  return edits
}

/** Source alpha only supplies lash centre lines; the source pixels are never repainted here.
 * Keep all feature meshes in the shared head frame rather than enabling the generated face rig. */
private fun referenceFeatureEdits(model: PuppetModel, layers: Map<String, ClassifiedLayer>): List<RigKeyformSetEdit> {
  val frame = referenceHeadFrame(model)
  val edits = mutableListOf<RigKeyformSetEdit>()
  fun centreLine(layer: ClassifiedLayer): (Float) -> Float {
    val raster = layer.source.raster
    val line = FloatArray(raster.width) { Float.NaN }
    for (x in line.indices) {
      var weight = 0f; var sum = 0f
      for (y in 0 until raster.height) {
        val alpha = (raster.rgba[(y * raster.width + x) * 4 + 3].toInt() and 255).toFloat()
        weight += alpha; sum += (y + 0.5f) * alpha
      }
      if (weight > 0f) line[x] = layer.source.bounds.top + sum / weight
    }
    val first = line.indexOfFirst { it.isFinite() }; require(first >= 0) { "Empty eyelash feature" }
    for (x in 0 until first) line[x] = line[first]
    var previous = first
    for (x in first + 1 until line.size) if (line[x].isFinite()) {
      for (i in previous + 1 until x) line[i] = line[previous] + (line[x] - line[previous]) * (i - previous).toFloat() / (x - previous)
      previous = x
    }
    for (x in previous + 1 until line.size) line[x] = line[previous]
    return { canvasX ->
      val x = (canvasX - layer.source.bounds.left).coerceIn(0f, line.lastIndex.toFloat())
      val left = x.toInt(); val right = minOf(left + 1, line.lastIndex)
      line[left] + (line[right] - line[left]) * (x - left)
    }
  }
  for ((side, key) in listOf("left" to "L", "right" to "R")) {
    val upper = centreLine(layers.getValue("eyelash-upper-$side"))
    val lower = centreLine(layers.getValue("eyelash-lower-$side"))
    val eye = layers.getValue("eye-white-$side").bounds
    // Fit the shared closure line to the original lash centres. A noisy per-column target
    // can fold irregular aperture triangles even though its analytic y-derivative is positive.
    // This affine seam gives the white mesh a positive Jacobian for EVERY source triangle.
    val sampleXs = (0..24).map { eye.left + eye.width * it / 24f }
    val sampleYs = sampleXs.map { upper(it) * 0.30f + lower(it) * 0.70f }
    val centerX = sampleXs.average().toFloat(); val centerY = sampleYs.average().toFloat()
    val slope = sampleXs.indices.sumOf { ((sampleXs[it] - centerX) * (sampleYs[it] - centerY)).toDouble() }.toFloat() /
      sampleXs.sumOf { ((it - centerX) * (it - centerX)).toDouble() }.toFloat()
    fun seam(x: Float): Float = centerY + slope * (x - centerX)
    fun affineLine(line: (Float) -> Float): (Float) -> Float {
      val values = sampleXs.map(line); val mean = values.average().toFloat()
      val gradient = sampleXs.indices.sumOf { ((sampleXs[it] - centerX) * (values[it] - mean)).toDouble() }.toFloat() /
        sampleXs.sumOf { ((it - centerX) * (it - centerX)).toDouble() }.toFloat()
      return { x -> mean + gradient * (x - centerX) }
    }
    val openParameter = "ParamEye${key}Open"
    for (name in listOf("eye-white-$side", "eyelash-upper-$side", "eyelash-lower-$side")) {
      val drawable = model.drawables.single { it.name.trim().lowercase() == name }
      val mesh = requireNotNull(drawable.mesh)
      val fullClose = FloatArray(mesh.positions.size)
      val fittedLash = affineLine(if (name.startsWith("eyelash-upper")) upper else lower)
      for (i in mesh.positions.indices step 2) {
        val x = frame.left + mesh.positions[i] * frame.width
        val y = frame.top + mesh.positions[i + 1] * frame.height
        // Affine lid-line translation/shear retains each lash's original curve and thickness.
        // Every source triangle keeps a positive Jacobian, including thin residual strokes.
        fullClose[i + 1] = (if (name.startsWith("eye-white")) (seam(x) - y) * 0.96f else seam(x) - fittedLash(x)) / frame.height
      }
      for (open in listOf(0f, 0.25f, 0.5f, 0.75f, 1f)) {
        val deltas = FloatArray(fullClose.size) { fullClose[it] * (1f - open) }
        edits += RigKeyformSetEdit(RigTargetRef(RigTargetKind.ART_MESH, drawable.id.raw), mapOf(openParameter to open), geometry = RigKeyformGeometryEdit(positionDeltas = deltas.toList()))
      }
    }
    val iris = model.drawables.single { it.name.trim().lowercase() == "iris-$side" }
    val irisMesh = requireNotNull(iris.mesh)
    for (x in listOf(-1f, 0f, 1f)) for (y in listOf(-1f, 0f, 1f)) {
      val deltas = FloatArray(irisMesh.positions.size) { if (it % 2 == 0) x * 3f / frame.width else -y * 2f / frame.height }
      edits += RigKeyformSetEdit(RigTargetRef(RigTargetKind.ART_MESH, iris.id.raw), mapOf("ParamEyeBallX" to x, "ParamEyeBallY" to y), geometry = RigKeyformGeometryEdit(positionDeltas = deltas.toList()))
    }
    // Geometry remains a non-degenerate sliver at exact closure; hide the sliver and lower line.
    // All partial closures retain the native aperture mask and native lid geometry.
    for (name in listOf("eye-white-$side", "iris-$side", "eyelash-lower-$side")) {
      val drawable = model.drawables.single { it.name.trim().lowercase() == name }
      for ((open, opacity) in listOf(0f to 0f, 0.25f to 1f, 1f to 1f)) edits += RigKeyformSetEdit(
        RigTargetRef(RigTargetKind.ART_MESH, drawable.id.raw), mapOf(openParameter to open), channels = RigKeyformChannelsEdit(opacity = opacity))
    }
    val brow = model.drawables.single { it.name.trim().lowercase() == "eyebrow-$side" }
    val browMesh = requireNotNull(brow.mesh)
    val source = layers.getValue("eyebrow-$side")
    for (height in listOf(-1f, 0f, 1f)) for (angle in listOf(-1f, 0f, 1f)) {
      // Both axes use the same canvas rotation sign. Runtime L+/R- raises both inner ends.
      val radians = Math.toRadians((angle * 4f).toDouble())
      val cosine = cos(radians).toFloat(); val sine = sin(radians).toFloat()
      val deltas = FloatArray(browMesh.positions.size)
      for (i in browMesh.positions.indices step 2) {
        val x = frame.left + browMesh.positions[i] * frame.width - source.centroidX
        val y = frame.top + browMesh.positions[i + 1] * frame.height - source.centroidY
        deltas[i] = (x * cosine - y * sine - x) / frame.width
        deltas[i + 1] = (x * sine + y * cosine - y - height * 4f) / frame.height
      }
      edits += RigKeyformSetEdit(RigTargetRef(RigTargetKind.ART_MESH, brow.id.raw), mapOf("ParamBrow${key}Y" to height, "ParamBrow${key}Angle" to angle), geometry = RigKeyformGeometryEdit(positionDeltas = deltas.toList()))
    }
  }
  return edits
}

private fun referenceLayeredConfig(pipeline: PSD2LivePipeline, input: Path, initial: PipelineConfig, gestures: Boolean = false, expressions: Boolean = false, features: Boolean = false): Pair<PipelineConfig, PuppetModel> {
  val inspected = pipeline.inspect(input, initial)
  require(inspected.source.widthPx == 1024 && inspected.source.heightPx == 1536) { "Reference profile is calibrated to the original 1024x1536 artwork" }
  val layers = inspected.layers.associateBy { it.source.name.trim().lowercase() }
  val requiredLayers = if (features) referenceFeatureBaseLayers + referenceFeatureLayers else referenceRequiredLayers
  require(layers.size == inspected.layers.size && layers.keys.containsAll(requiredLayers)) { "Reference PSD has duplicate or missing required layers" }
  val allowedEmotions = referenceOriginalEmotions + if (expressions) referenceNewEmotions else emptySet()
  require(layers.keys.all { it in requiredLayers || (!features && it in allowedEmotions) }) { "Unexpected reference-layered source layer" }
  require(layers.values.all { it.opaquePixels > 0 }) { "Reference source contains empty layers" }
  if (gestures) require(layers.size == (if (features) 16 else if (expressions) 14 else 11) && (features || layers.keys.containsAll(allowedEmotions))) { "Reference gestures require the selected profile's complete layer set" }
  val overrides = layers.map { (name, layer) -> layer.source.id.raw to when (name) {
    "topwear" -> LayerClassificationOverride(tag = SemanticTag.TOPWEAR)
    "face" -> LayerClassificationOverride(tag = SemanticTag.FACE)
    "front hair 1", "front hair 2" -> LayerClassificationOverride(tag = SemanticTag.FRONT_HAIR)
    in referenceFeatureLayers -> LayerClassificationOverride(tag = SemanticTag.FACE_DETAIL)
    else -> LayerClassificationOverride(type = LayerType.TOGGLE, tag = SemanticTag.FACE_DETAIL, parameter = referencePatchBindings.getValue(name))
  } }.toMap()
  val orders = layers.map { (name, layer) -> layer.source.id.raw to when (name) {
    "topwear" -> 100f; "face" -> 200f; "front hair 1", "front hair 2" -> 210f
    "warm", "sad", "pout", "shy", "surprise", "relaxed" -> 300f; "blink-left", "blink-right" -> 310f; "mouth-a" -> 320f
    "eye-white-left", "eye-white-right" -> 280f; "iris-left", "iris-right" -> 285f
    "eyebrow-left", "eyebrow-right" -> 290f; "eyelash-upper-left", "eyelash-upper-right", "eyelash-lower-left", "eyelash-lower-right" -> 295f
    else -> 330f
  } }.toMap()
  val meshSettings = listOf("mouth-a", "mouth-o").associate { name ->
    layers.getValue(name).source.id.raw to MeshSettings(interiorDensity = 8f, edgeWidth = 3f, maxEdgeDistance = 4f)
  }.toMutableMap()
  if (gestures) meshSettings[layers.getValue("topwear").source.id.raw] = MeshSettings(interiorDensity = 16f, edgeWidth = 5f, maxEdgeDistance = 10f)
  if (features) for (name in referenceFeatureLayers) meshSettings[layers.getValue(name).source.id.raw] = MeshSettings(interiorDensity = 5f, edgeWidth = 2f, maxEdgeDistance = 3f)
  var config = initial.copy(
    layerOverrides = overrides, drawOrderOverrides = orders,
    parentOverrides = layers.filterKeys { it == "face" || it in referencePatchBindings || it in referenceFeatureLayers }.values.associate { it.source.id.raw to "DeformHeadContainer" },
    layerVisibility = layers.values.associate { it.source.id.raw to true },
    meshOverrides = meshSettings,
  )
  val preview = pipeline.buildPreview(input, config).rig.puppet
  val headMeshes = preview.drawables.filter { it.parentDeformerId?.raw == "DeformHeadContainer" }.map { it.id.raw }
  val body = preview.drawables.single { it.name.trim().lowercase() == "topwear" }
  require(body.parentDeformerId?.raw == "DeformBodyZBreath" && headMeshes.size == layers.keys.count { it == "face" || it in referencePatchBindings || it in referenceFeatureLayers }) { "Reference layer parent frames changed" }
  config = config.copy(rigEdits = config.rigEdits.copy(
    warpEdits = listOf(
      // Public API requests are limited to <=32; matching the parent's 5x4 knots expands this
      // 20x32 request to the intended effective 40x32 lattice without altering the compiler.
      RigWarpEdit("DeformReferenceHead", "Reference head: rigid face and fixed neck", "DeformHeadContainer", headMeshes, rows = 20, columns = 32),
      RigWarpEdit("DeformReferenceBody", "Reference body: pinned neck and shoulders", "DeformBodyZBreath", listOf(body.id.raw), rows = 18, columns = 12),
    ),
    structureEdits = listOf(buildJsonObject {
      put("action", "move"); put("kind", "warp"); put("id", "DeformHairFrontFollow"); put("parent_id", "DeformReferenceHead"); put("space", "local")
    }),
  ))
  val baseline = pipeline.buildPreview(input, config).rig.puppet
  val maskEdits = if (features) listOf("left", "right").map { side -> buildJsonObject {
    put("action", "static"); put("kind", "mesh")
    put("id", baseline.drawables.single { it.name.trim().lowercase() == "iris-$side" }.id.raw)
    put("masked_by", JsonArray(listOf(JsonPrimitive(baseline.drawables.single { it.name.trim().lowercase() == "eye-white-$side" }.id.raw))))
  } } else emptyList()
  return config.copy(rigEdits = config.rigEdits.copy(
    parameterEdits = (if (gestures) referenceGestureParameters else emptyList()) + (if (features) referenceFeatureParameters else emptyList()),
    structureEdits = config.rigEdits.structureEdits + maskEdits,
    keyformSetEdits = referenceLayeredEdits(baseline) + (if (gestures) referenceGestureEdits(baseline) else emptyList()) + (if (features) referenceFeatureEdits(baseline, layers) else emptyList()),
    deletedParameterIds = referenceUnusedParameters - (if (features) referenceFeatureIds else emptySet()),
  )) to baseline
}

private fun assertReferenceLayered(baseline: PuppetModel, exported: PuppetModel, gestures: Boolean = false, expressions: Boolean = false, features: Boolean = false) {
  val headFrame = referenceHeadFrame(exported); val bodyFrame = referenceRootFrame(exported)
  val patchParameters = exported.drawables.mapNotNull { referencePatchBindings[it.name.trim().lowercase()] }.toSet()
  val expectedParameters = referenceStandardBindings + patchParameters + (if (gestures) referenceGestureIds else emptySet()) + (if (features) referenceFeatureIds else emptySet())
  require(exported.parameters.map { it.id.raw }.toSet() == expectedParameters) { "Reference export contains unbound or missing parameters" }
  for (before in baseline.deformers) {
    val after = exported.deformers.single { it.id == before.id }
    require(before.parent == after.parent) { "Reference export changed deformer parent: ${before.id.raw}" }
    if (before !is Deformer.Warp || after !is Deformer.Warp) continue
    val rest = neutralCell(requireNotNull(before.geometryGrid), baseline).form.controlPoints
    val grid = requireNotNull(after.geometryGrid)
    require(neutralCell(grid, exported).form.controlPoints.contentEquals(rest)) { "Reference export changed rest lattice: ${after.id.raw}" }
    if (after.id.raw !in setOf("DeformReferenceHead", "DeformReferenceBody", "DeformHairFrontPhysics")) require(grid.cells.all { it.form.controlPoints.contentEquals(rest) }) { "Generated warp still tugs original pixels: ${after.id.raw}" }
    if (after.id.raw == "DeformReferenceHead" || after.id.raw == "DeformReferenceBody") {
      val frame = if (after.id.raw == "DeformReferenceHead") headFrame else bodyFrame
      val moving = grid.cells.any { !it.form.controlPoints.contentEquals(rest) }
      require(moving) { "Reference animation was disabled: ${after.id.raw}" }
      for (cell in grid.cells) for (i in rest.indices step 2) {
        val py = frame.top + rest[i + 1] * frame.height
        val pinned = if (after.id.raw == "DeformReferenceHead") py >= 680f else py <= 860f
        if (pinned) require(cell.form.controlPoints[i] == rest[i] && cell.form.controlPoints[i + 1] == rest[i + 1]) { "Reference neck/shoulder anchor moved: ${after.id.raw}" }
      }
      if (after.id.raw == "DeformReferenceHead") {
        val lastRigidRow = (0..after.rows).last { r -> headFrame.top + rest[r * (after.columns + 1) * 2 + 1] * headFrame.height <= 620f }
        require(lastRigidRow >= 2) { "Reference face has no rigid upper region" }
        val right = after.columns * 2; val bottom = lastRigidRow * (after.columns + 1) * 2
        fun distance(points: FloatArray, a: Int, b: Int) = hypot((points[a] - points[b]) * headFrame.width, (points[a + 1] - points[b + 1]) * headFrame.height)
        for (cell in grid.cells) {
          val points = cell.form.controlPoints
          for (corner in listOf(right, bottom, bottom + right)) require(abs(distance(points, 0, corner) - distance(rest, 0, corner)) <= 0.008f) { "Reference face stretches its original proportions" }
          for (r in 0..lastRigidRow) for (c in 0..after.columns) {
            val i = (r * (after.columns + 1) + c) * 2
            for (axis in 0..1) {
              val predicted = points[axis] + c.toFloat() / after.columns * (points[right + axis] - points[axis]) + r.toFloat() / lastRigidRow * (points[bottom + axis] - points[axis])
              require(abs(points[i + axis] - predicted) * (if (axis == 0) headFrame.width else headFrame.height) <= 0.008f) { "Reference upper face has independent local distortion" }
            }
          }
        }
      }
    }
    if (after.id.raw == "DeformHairFrontPhysics") {
      val pinnedSize = 3 * (after.columns + 1) * 2
      require(grid.cells.all { cell -> (0 until pinnedSize).all { cell.form.controlPoints[it] == rest[it] } }) { "Reference hair root moved" }
      require(grid.cells.any { !it.form.controlPoints.contentEquals(rest) }) { "Reference hair tips became static" }
    }
  }
  for (before in baseline.drawables) {
    val after = exported.drawables.single { it.id == before.id }
    require(before.parentDeformerId == after.parentDeformerId && requireNotNull(before.mesh).positions.contentEquals(requireNotNull(after.mesh).positions)) { "Reference drawable rest frame changed: ${after.name}" }
    val name = after.name.trim().lowercase()
    if (name == "topwear") require(after.parentDeformerId?.raw == "DeformReferenceBody")
    else if (name in referencePatchBindings || name in referenceFeatureLayers || name == "face") require(after.parentDeformerId?.raw == "DeformReferenceHead") { "Facial patch escaped shared head frame: $name" }
    if (name !in referencePatchBindings) continue
    val parameter = referencePatchBindings.getValue(name)
    val expectedDefault = if (name.startsWith("blink-")) 1f else 0f
    require(exported.parameters.any { it.id.raw == parameter && it.min == 0f && it.max == 1f && it.default == expectedDefault }) { "Reference patch parameter contract changed: $parameter" }
    val opacity = requireNotNull(after.channelGrids[FormChannel.OPACITY])
    require((neutralCell(opacity, exported).form as ChannelValue.Scalar).value == 0f) { "Reference rest pose exposes patch: $name" }
    if (!name.startsWith("mouth-")) continue
    val mesh = requireNotNull(after.mesh); val geometry = requireNotNull(after.geometryGrid)
    require(geometry.axes.any { it.parameterId.raw == "ParamMouthOpenY" } && geometry.cells.any { cell -> cell.form.positionDeltas.any { it != 0f } }) { "Reference lip geometry is not bound" }
    for (cell in geometry.cells) for (i in mesh.positions.indices step 2) {
      val px = headFrame.left + mesh.positions[i] * headFrame.width
      val py = headFrame.top + mesh.positions[i + 1] * headFrame.height
      require(cell.form.positionDeltas[i] == 0f && abs(cell.form.positionDeltas[i + 1]) * headFrame.height <= 12.001f) { "Lip deformation exceeds its local vertical budget" }
      if (px <= 474f || px >= 562f || py <= 465f || py >= 529f) require(cell.form.positionDeltas[i + 1] == 0f) { "Lip deformation moves outer skin or patch boundary" }
    }
  }
  val headRotation = exported.deformers.single { it.id.raw == "DeformHeadRotation" } as Deformer.Rotation
  require(requireNotNull(headRotation.geometryGrid).cells.all { it.form.angle == 0f && it.form.scale == 1f }) { "Head rotation bypasses the fixed neck transition" }
  if (gestures) assertReferenceGestures(exported, expressions, features)
  if (features) assertReferenceFeatures(exported)
}

/** These checks concern the actual author's exported mesh/keyforms, not a screen overlay.
 * Official Core and browser pose checks are still required for the generated MOC3. */
private fun assertReferenceGestures(model: PuppetModel, expressions: Boolean = false, features: Boolean = false) {
  require(model.drawables.size == if (features) 16 else if (expressions) 14 else 11) { "Hand gestures must retain only the selected profile's reviewed drawings" }
  for (spec in referenceGestureParameters) require(model.parameters.any {
    it.id.raw == spec.id && it.min == spec.min && it.max == spec.max && it.default == 0f
  }) { "Gesture parameter contract changed: ${spec.id}" }
  val body = model.drawables.single { it.name.trim().lowercase() == "topwear" }
  val mesh = requireNotNull(body.mesh)
  val frame = referenceRootFrame(model)
  val grid = requireNotNull(body.geometryGrid) { "Hand gestures have no native mesh geometry" }
  require(mesh.vertexCount in 150..8000) { "Hand mesh has insufficient geometry or exceeds its authoring budget" }
  require(grid.axes.map { it.parameterId.raw }.toSet() == referenceGestureIds && grid.cells.size == 27) { "Gesture mesh lacks the complete three-axis keyform grid" }
  for (axis in grid.axes) {
    val expected = if (axis.parameterId.raw == "ParamHandsSway") floatArrayOf(-1f, 0f, 1f) else floatArrayOf(0f, 0.5f, 1f)
    require(axis.keys.contentEquals(expected)) { "Gesture keys changed: ${axis.parameterId.raw}" }
  }
  require(neutralCell(grid, model).form.positionDeltas.all { it == 0f }) { "Gesture default must preserve every original pixel position" }
  for (drawable in model.drawables) {
    if (drawable.id != body.id) require(drawable.geometryGrid?.axes.orEmpty().none { it.parameterId.raw in referenceGestureIds }) { "Hand geometry escaped to ${drawable.name}" }
    require(drawable.channelGrids.gridsByChannel.values.none { channel -> channel.axes.any { it.parameterId.raw in referenceGestureIds } }) { "Hand gestures must not change visibility, color, or draw order" }
  }
  for (deformer in model.deformers) {
    val parameters = when (deformer) {
      is Deformer.Warp -> deformer.geometryGrid?.axes.orEmpty().map { it.parameterId.raw }
      is Deformer.Rotation -> deformer.geometryGrid?.axes.orEmpty().map { it.parameterId.raw }
    }
    require(parameters.none { it in referenceGestureIds }) { "Hand parameters must not drive any head/body deformer" }
  }
  val canvas = FloatArray(mesh.positions.size) { i ->
    if (i % 2 == 0) frame.left + mesh.positions[i] * frame.width else frame.top + mesh.positions[i] * frame.height
  }
  val hands = mesh.positions.indices.step(2).filter { i -> canvas[i] in 340f..692f && canvas[i + 1] in 1270f..1455f }
  require(hands.size >= 20) { "Gesture assertion does not cover both actual hands" }
  require(mesh.positions.indices.step(2).count { canvas[it + 1] <= 860f } >= 10) { "Gesture assertion does not cover the fixed neckline" }
  val handXs = hands.map { canvas[it] }
  require(handXs.min() < 390f && handXs.max() > 640f) { "Gesture assertion sees only one hand" }
  for (cell in grid.cells) {
    val values = coordinate(grid, cell)
    val delta = cell.form.positionDeltas
    require(delta.size == mesh.positions.size && delta.all { it.isFinite() }) { "Invalid native gesture mesh deltas" }
    val expectedX = values.getValue("ParamHandsSway") * 6f
    val expectedY = values.getValue("ParamHandsLift") * -16f
    for (i in mesh.positions.indices step 2) {
      val dx = delta[i] * frame.width; val dy = delta[i + 1] * frame.height
      require(hypot(dx, dy) <= 17.10f) { "Hand/sleeve geometry exceeds its 17.1px authoring budget" }
      if (canvas[i + 1] <= 920f) require(delta[i] == 0f && delta[i + 1] == 0f) { "Hand gestures moved the pinned neck/shoulder buffer" }
    }
    for (i in hands) require(abs(delta[i] * frame.width - expectedX) < 0.005f && abs(delta[i + 1] * frame.height - expectedY) < 0.005f) { "Fingers or hand contact were stretched instead of moving together" }
    val moved = FloatArray(canvas.size) { i -> canvas[i] + delta[i] * if (i % 2 == 0) frame.width else frame.height }
    fun signedArea(points: FloatArray, a: Int, b: Int, c: Int): Float =
      (points[b] - points[a]) * (points[c + 1] - points[a + 1]) - (points[b + 1] - points[a + 1]) * (points[c] - points[a])
    for (triangle in mesh.indices.indices step 3) {
      val vertices = listOf(mesh.indices[triangle] * 2, mesh.indices[triangle + 1] * 2, mesh.indices[triangle + 2] * 2)
      val (a, b, c) = vertices
      val restArea = signedArea(canvas, a, b, c)
      // Ignore numerically degenerate baseline slivers; significant triangles may not flip,
      // collapse or stretch substantially. Every coordinate itself remains checked above.
      if (abs(restArea) > 0.1f) {
        val ratio = signedArea(moved, a, b, c) / restArea
        require(ratio in 0.60f..1.50f) { "Gesture folds or over-stretches a native clothing triangle" }
      }
      if (vertices.any { canvas[it + 1] <= 860f }) require(vertices.all { delta[it] == 0f && delta[it + 1] == 0f }) { "Triangle interpolation leaks gesture motion into the neckline" }
      val overlapsHands = vertices.maxOf { canvas[it] } >= 340f && vertices.minOf { canvas[it] } <= 692f &&
        vertices.maxOf { canvas[it + 1] } >= 1270f && vertices.minOf { canvas[it + 1] } <= 1455f
      if (overlapsHands) require(vertices.all {
        abs(delta[it] * frame.width - expectedX) < 0.005f && abs(delta[it + 1] * frame.height - expectedY) < 0.005f
      }) { "Triangle interpolation tugs the original hand silhouette" }
    }
  }
  for (id in referenceGestureIds) require(grid.cells.any { cell ->
    val values = coordinate(grid, cell)
    values.getValue(id) != 0f && referenceGestureIds.filter { it != id }.all { values.getValue(it) == 0f } && cell.form.positionDeltas.any { it != 0f }
  }) { "Gesture parameter has no independent native geometry effect: $id" }
}

private fun assertReferenceFeatures(model: PuppetModel) {
  require(model.drawables.map { it.name.trim().lowercase() }.toSet() == referenceFeatureBaseLayers + referenceFeatureLayers) { "Independent feature source contract changed" }
  val frame = referenceHeadFrame(model)
  for ((side, key) in listOf("left" to "L", "right" to "R")) {
    fun drawable(name: String) = model.drawables.single { it.name.trim().lowercase() == "$name-$side" }
    val iris = drawable("iris"); val white = drawable("eye-white")
    require(iris.maskedBy == listOf(white.id)) { "Iris must use its own native eye-white clipping mask" }
    val gaze = requireNotNull(iris.geometryGrid)
    require(gaze.axes.map { it.parameterId.raw }.toSet() == setOf("ParamEyeBallX", "ParamEyeBallY") && gaze.cells.size == 9) { "Independent iris requires a two-axis native geometry grid" }
    for (cell in gaze.cells) {
      val values = coordinate(gaze, cell); val delta = cell.form.positionDeltas
      for (i in delta.indices step 2) require(abs(delta[i] * frame.width - values.getValue("ParamEyeBallX") * 3f) < 0.001f && abs(delta[i + 1] * frame.height + values.getValue("ParamEyeBallY") * 2f) < 0.001f) { "Iris gaze scales or distorts its native bitmap" }
    }
    val eyeId = "ParamEye${key}Open"
    require(model.parameters.any { it.id.raw == eyeId && it.min == 0f && it.max == 1f && it.default == 1f }) { "Feature eye parameter default/range changed" }
    for (name in listOf("eye-white", "eyelash-upper", "eyelash-lower")) {
      val item = drawable(name); val grid = requireNotNull(item.geometryGrid)
      require(grid.axes.size == 1 && grid.axes.single().parameterId.raw == eyeId && grid.axes.single().keys.contentEquals(floatArrayOf(0f, 0.25f, 0.5f, 0.75f, 1f))) { "Independent eyelids require five continuous native geometry keys" }
      require(neutralCell(grid, model).form.positionDeltas.all { it == 0f }) { "Open eye must preserve the original artwork positions" }
      require(grid.cells.any { it.form.positionDeltas.any { value -> abs(value) > 0.000001f } }) { "Eyelid has no native geometry response" }
      for (cell in grid.cells) for (i in cell.form.positionDeltas.indices step 2) require(cell.form.positionDeltas[i] == 0f && abs(cell.form.positionDeltas[i + 1]) * frame.height < 110f) { "Eyelid leaves its local vertical authoring budget" }
      val mesh = requireNotNull(item.mesh)
      fun area(points: FloatArray, a: Int, b: Int, c: Int) = (points[b] - points[a]) * (points[c + 1] - points[a + 1]) - (points[b + 1] - points[a + 1]) * (points[c] - points[a])
      for (cell in grid.cells) {
        val moved = FloatArray(mesh.positions.size) { mesh.positions[it] + cell.form.positionDeltas[it] }
        for (triangle in mesh.indices.indices step 3) {
          val a = mesh.indices[triangle] * 2; val b = mesh.indices[triangle + 1] * 2; val c = mesh.indices[triangle + 2] * 2
          val originalArea = area(mesh.positions, a, b, c)
          if (abs(originalArea) * frame.width * frame.height > 0.1f) require(area(moved, a, b, c) / originalArea > 0.001f) { "Eyelid native geometry folds a source triangle: ${item.name}" }
        }
      }
    }
    val brow = drawable("eyebrow"); val browGrid = requireNotNull(brow.geometryGrid)
    require(browGrid.axes.map { it.parameterId.raw }.toSet() == setOf("ParamBrow${key}Y", "ParamBrow${key}Angle") && browGrid.cells.size == 9) { "Brow height and angle must be independent native axes" }
    require(neutralCell(browGrid, model).form.positionDeltas.all { it == 0f }) { "Neutral brow geometry changed" }
    val featureAxes = setOf(eyeId, "ParamBrow${key}Y", "ParamBrow${key}Angle")
    for (item in model.drawables) {
      val name = item.name.trim().lowercase()
      if (name !in referenceFeatureLayers.filter { it.endsWith("-$side") }) require(item.geometryGrid?.axes.orEmpty().none { it.parameterId.raw in featureAxes }) { "Feature geometry leaks into another face/eye/body drawing" }
      if (!name.startsWith("iris-")) require(item.geometryGrid?.axes.orEmpty().none { it.parameterId.raw in setOf("ParamEyeBallX", "ParamEyeBallY") }) { "Gaze translates a whole eye/face rather than the independent iris" }
    }
  }
  for (spec in referenceFeatureParameters) require(model.parameters.any { it.id.raw == spec.id && it.min == spec.min && it.max == spec.max && it.default == spec.default }) { "Feature parameter contract changed: ${spec.id}" }
}

/** The frozen generator's metadata describes its PRESET base before our public authoring edits.
 * Correct only these verified profile facts after all authoring assertions succeed; preserve the
 * original diagnostics separately so provenance is not silently lost. */
private fun writeReferenceMetadata(output: Path, model: PuppetModel, gestures: Boolean = false, expressions: Boolean = false, features: Boolean = false) {
  Files.list(output).use { entries -> entries.filter { it.fileName.toString().endsWith(".psd2live.json") }.forEach { path ->
    val base = Json.parseToJsonElement(Files.readString(path)).jsonObject
    val baseWarnings = requireNotNull(base["warnings"]).jsonArray
    val warnings = baseWarnings.map { warning -> JsonPrimitive(when (val message = warning.jsonPrimitive.content) {
      "Eye semantic layers are missing; blink and gaze parameters will not be bound to any drawable." ->
        if (features) "Reference-features uses independent native iris geometry, eye-white clipping masks, continuous eyelid geometry and two-axis eyebrow geometry in the shared rigid head frame."
        else "Reference-layered uses native local blink opacity bindings; independent eye-gaze and continuous eyelid geometry are not authored."
      "mouth/mouth_open/mouth_close is missing; lip-sync parameters will not be bound to any drawable." ->
        "Reference-layered uses ParamMouthOpenY local native lip geometry with ParamMouthA/O occlusion patches, not mouth PRESET layers."
      else -> message
    }) }.toMutableList()
    if (gestures) warnings += JsonPrimitive("Reference-gestures adds bounded shared clasped-hand translation and local sleeve geometry to the unchanged illustration; no independent fingers, raised-arm pose, or occluded torso artwork is authored.")
    if (expressions) warnings += JsonPrimitive("Reference-expressions adds local shy, surprise and relaxed facial opacity patches in the same rigid head frame; they do not create continuous eyelid, iris or brow geometry.")
    val hierarchy = requireNotNull(base["deformerHierarchy"]).jsonObject.toMutableMap().apply {
      put("head", JsonPrimitive("DeformReferenceHead")); put("headContainer", JsonPrimitive("DeformHeadContainer"))
      put("face", JsonPrimitive("DeformReferenceHead")); put("body", JsonPrimitive("DeformReferenceBody")); put("backHair", JsonArray(emptyList()))
    }
    val metadata = JsonObject(base.toMutableMap().apply {
      put("petpalAuthoringProfile", JsonPrimitive(if (features) "reference-features" else if (expressions) "reference-expressions" else if (gestures) "reference-gestures" else "reference-layered"))
      put("generatedBaseWarnings", baseWarnings); put("warnings", JsonArray(warnings)); put("deformerHierarchy", JsonObject(hierarchy))
      put("nativeBoundParameterIds", JsonArray(model.parameters.map { JsonPrimitive(it.id.raw) }))
      if (gestures) put("gestureAuthoring", buildJsonObject {
        put("source", if (features) "Original topwear and hair retained; independent facial feature layers; original gesture geometry retained" else if (expressions) "Original eleven V7 layers plus three local facial patches; original gesture geometry retained" else "Unchanged eleven-layer V7 PSD; refined topwear ArtMesh only")
        put("parameters", JsonArray(referenceGestureIds.map { JsonPrimitive(it) }))
        put("keyformCombinations", 27)
        put("handsSharedLiftPixels", 16)
        put("handsSharedSwayPixels", 6)
        put("sleeveEasePixels", 3)
        put("gestureMaxDisplacementPixels", 17.1)
        put("fixedNecklineThroughY", 860)
        put("independentFingerRig", false)
        put("independentArmRig", false)
        put("raisedHandPose", false)
        put("occludedArtworkRepainted", false)
        put("validationBoundary", "Authoring geometry assertions only; official Core, browser motion, and Cubism Editor compatibility require separate verification")
      })
      if (expressions) put("expressionAuthoring", buildJsonObject {
        put("newLayers", JsonArray(referenceNewEmotions.map { JsonPrimitive(it) }))
        put("newParameters", JsonArray(referenceNewEmotions.map { JsonPrimitive(referencePatchBindings.getValue(it)) }))
        put("parent", "DeformReferenceHead")
        put("expressionDrawOrder", 300)
        put("blinkDrawOrder", 310)
        put("mouthDrawOrders", JsonArray(listOf(JsonPrimitive(320), JsonPrimitive(330))))
        put("neutralOpacity", 0)
        put("independentFeatureGeometry", false)
      })
      if (features) put("featureAuthoring", buildJsonObject {
        put("layers", JsonArray(referenceFeatureLayers.map { JsonPrimitive(it) }))
        put("parameters", JsonArray(referenceFeatureIds.map { JsonPrimitive(it) }))
        put("parent", "DeformReferenceHead"); put("independentFeatureGeometry", true)
        put("nativeIrisClipMasks", true); put("wholeFaceExpressionPatches", false)
        put("irisTravelPixels", JsonArray(listOf(JsonPrimitive(3), JsonPrimitive(2))))
        put("browHeightPixels", 4); put("browAngleDegrees", 4)
        put("eyelidKeys", JsonArray(listOf(0, 0.25, 0.5, 0.75, 1).map { JsonPrimitive(it) }))
        put("mouthBoundary", "Existing A/O lip patches and ParamMouthOpenY retained; no independent mouth-corner or mouth-form geometry")
      })
    })
    Files.writeString(path, Json { prettyPrint = true }.encodeToString(JsonObject.serializer(), metadata) + "\n")
  } }
}

// Independent authoring client for the frozen GPL tool. It is never part of the PetPal application.
fun main(arguments: Array<String>) {
  require(arguments.size in 2..3) { "Usage: <layered-PSD> <local-output-directory> [classic|continuous-body|stable-portrait|reference-layered|reference-gestures|reference-expressions|reference-features]" }
  val profile = arguments.getOrElse(2) { "classic" }
  require(profile in setOf("classic", "continuous-body", "stable-portrait", "reference-layered", "reference-gestures", "reference-expressions", "reference-features")) { "Unknown authoring profile: $profile" }
  val referenceFeatures = profile == "reference-features"
  val referenceExpressions = profile == "reference-expressions"
  val referenceGestures = profile in setOf("reference-gestures", "reference-expressions", "reference-features")
  val referenceLayered = profile in setOf("reference-layered", "reference-gestures", "reference-expressions", "reference-features")
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
    headTurnStrength = if (referenceLayered) 0f else if (continuousBody) 0.25f else 0.55f,
    bodyStrength = if (referenceLayered) 0f else if (continuousBody) 0.30f else 0.65f,
    textureUpscale = TextureUpscaleConfig(scale = 1),
    physicsEyeJelly = !stablePortrait && !referenceLayered,
    mouthOutlineEnabled = !stablePortrait && !referenceLayered,
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
  val requiredBindings = if (referenceLayered) emptyMap() else mapOf("blush" to "ParamCheek", "tears" to "ParamTear")
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
  var referenceBaseline: PuppetModel? = null
  val exportConfig = if (referenceLayered) {
    referenceLayeredConfig(pipeline, input, initialConfig, referenceGestures, referenceExpressions, referenceFeatures).also { referenceBaseline = it.second }.first
  } else if (continuousBody) {
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
  if (referenceLayered) {
    assertReferenceLayered(requireNotNull(referenceBaseline), model, referenceGestures, referenceExpressions, referenceFeatures)
    writeReferenceMetadata(output, model, referenceGestures, referenceExpressions, referenceFeatures)
    println("Reference layered: shared rigid head with fixed neck transition; independently pinned body; 1.25px anchored hair tips; A/O lip shapes retained")
    if (referenceGestures) println("Reference gestures: original clasped hands translate together up to 16px vertically and 6px horizontally; local 3px sleeve easing; fixed neckline and unchanged face/hair; not independent fingers or raised arms")
    if (referenceExpressions) println("Reference expressions: three additional local facial patches share the rigid head frame, start transparent, and remain below blink and A/O speaking mouth patches")
    if (referenceFeatures) println("Reference features: independent iris geometry with native eye-white masks; five continuous eyelid keys; independent two-axis eyebrows; no whole-face expression patches or new mouth-form geometry")
  }
  println("Exported ${result.exportedFiles.size} files; ${model.parameters.size} parameters; ${model.drawables.size} drawables; profile=$profile")
  result.warnings.forEach { System.err.println("Warning: $it") }
}
