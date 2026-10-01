// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 PetPal contributors. Original authoring client, 2026-10-01.
// Uses the public API of PSD2Live at 2ac751fbb3ffdc8251a82e0d600d97afafafcaac.
import io.github.psd2live.core.LayerClassificationOverride
import io.github.psd2live.core.LayerType
import io.github.psd2live.core.PSD2LivePipeline
import io.github.psd2live.core.PipelineConfig
import io.github.psd2live.core.ProgressListener
import io.github.psd2live.core.RigKeyformGeometryEdit
import io.github.psd2live.core.RigKeyformSetEdit
import io.github.psd2live.core.RigTargetKind
import io.github.psd2live.core.RigTargetRef
import io.github.psd2live.core.SemanticTag
import io.github.psd2live.core.TextureUpscaleConfig
import io.github.psd2live.i18n.AppLanguage
import io.github.psd2live.i18n.I18n
import org.umamo.runtime.model.Deformer
import java.nio.file.Files
import java.nio.file.Path

// Independent authoring client for the frozen GPL tool. It is never part of the PetPal application.
fun main(arguments: Array<String>) {
  require(arguments.size in 2..3) { "Usage: <layered-PSD> <local-output-directory> [classic|continuous-body]" }
  val profile = arguments.getOrElse(2) { "classic" }
  require(profile in setOf("classic", "continuous-body")) { "Unknown authoring profile: $profile" }
  val continuousBody = profile == "continuous-body"
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
  val exportConfig = if (continuousBody) {
    // Reinspect with the same classifications that run() will use. Reusing the earlier analysis
    // with new overrides would leave its semantic tags out of sync with the export configuration.
    val preview = pipeline.buildPreview(input, boundConfig)
    val rotation = preview.rig.puppet.deformers.single { it.id.raw == "DeformHeadRotation" } as Deformer.Rotation
    val grid = requireNotNull(rotation.geometryGrid) { "Generated head rotation keyforms are missing" }
    val axis = grid.axes.single()
    require(axis.parameterId.raw == "ParamAngleZ" && axis.keys.contentEquals(floatArrayOf(-30f, 0f, 30f))) {
      "Unexpected generated head rotation axis"
    }
    val corrections = grid.cells.map { cell ->
      require(cell.coordinate.size == 1) { "Unexpected head rotation keyform coordinate" }
      val form = cell.form
      val key = axis.keys[cell.coordinate.single()]
      require(key != 0f || form.angle == 0f) { "Neutral head rotation must remain unchanged" }
      RigKeyformSetEdit(
        target = RigTargetRef(RigTargetKind.ROTATION_DEFORMER, rotation.id.raw),
        coordinate = mapOf(axis.parameterId.raw to key),
        geometry = RigKeyformGeometryEdit(
          originX = form.originX, originY = form.originY, angle = form.angle * 0.20f, scale = form.scale,
        ),
      )
    }
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
    require(grid.cells.all { kotlin.math.abs(it.form.angle) <= 6.0001f }) { "Head rotation attenuation was not retained" }
    val axis = grid.axes.single()
    require(grid.cells.single { axis.keys[it.coordinate.single()] == 0f }.form.angle == 0f) {
      "Neutral head rotation changed during export"
    }
  }
  println("Exported ${result.exportedFiles.size} files; ${model.parameters.size} parameters; ${model.drawables.size} drawables; profile=$profile")
  result.warnings.forEach { System.err.println("Warning: $it") }
}
