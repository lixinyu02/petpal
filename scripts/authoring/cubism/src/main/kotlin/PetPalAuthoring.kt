// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 PetPal contributors. Original authoring client, 2026-10-01.
// Uses the public API of PSD2Live at 2ac751fbb3ffdc8251a82e0d600d97afafafcaac.
import io.github.psd2live.core.LayerClassificationOverride
import io.github.psd2live.core.LayerType
import io.github.psd2live.core.PSD2LivePipeline
import io.github.psd2live.core.PipelineConfig
import io.github.psd2live.core.ProgressListener
import io.github.psd2live.core.SemanticTag
import io.github.psd2live.core.TextureUpscaleConfig
import io.github.psd2live.i18n.AppLanguage
import io.github.psd2live.i18n.I18n
import java.nio.file.Files
import java.nio.file.Path

// Independent authoring client for the frozen GPL tool. It is never part of the PetPal application.
fun main(arguments: Array<String>) {
  require(arguments.size == 2) { "Usage: <layered-PSD> <local-output-directory>" }
  I18n.setLanguage(AppLanguage.ENGLISH, persist = false)
  val input = Path.of(arguments[0]).toAbsolutePath().normalize()
  val output = Path.of(arguments[1]).toAbsolutePath().normalize()
  val projectRoot = Path.of(requireNotNull(System.getProperty("petpal.authoring.projectRoot")) {
    "Use scripts/authoring/Build-AkariCubism.ps1 to supply the actual project root"
  }).toAbsolutePath().normalize()
  require(input.startsWith(projectRoot) && output.startsWith(projectRoot)) { "Authoring paths must remain inside PetPal" }
  require(Files.isRegularFile(input) && input.toString().endsWith(".psd")) { "A real layered PSD is required" }
  val initialConfig = PipelineConfig(
    atlasSize = 2048, meshSpacing = 48, headTurnStrength = 0.55f, bodyStrength = 0.65f,
    textureUpscale = TextureUpscaleConfig(scale = 1),
  )
  val pipeline = PSD2LivePipeline()
  val inspected = pipeline.inspect(input, initialConfig)
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
  val result = pipeline.run(input, output, initialConfig.copy(layerOverrides = overrides), ProgressListener { stage, fraction ->
    println("%3d%%  %s".format((fraction * 100).toInt(), stage))
  })
  val model = result.previewModel.rig.puppet
  for (id in requiredBindings.values) {
    require(model.parameters.any { it.id.raw == id && it.min == 0f && it.max == 1f && it.default == 0f }) {
      "Generated parameter range/default mismatch: $id"
    }
  }
  println("Exported ${result.exportedFiles.size} files; ${model.parameters.size} parameters; ${model.drawables.size} drawables")
  result.warnings.forEach { System.err.println("Warning: $it") }
}
