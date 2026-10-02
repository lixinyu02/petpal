// SPDX-License-Identifier: GPL-3.0-only
// V12 changes local eye geometry only. It never paints or resamples source pixels.
import io.github.psd2live.core.ClassifiedLayer
import io.github.psd2live.core.PipelineConfig
import io.github.psd2live.core.PipelineResult
import kotlinx.serialization.json.*
import org.umamo.format.moc3.Moc3
import org.umamo.format.cmo3.Cmo3
import org.umamo.format.cmo3.model.custom.CModelSource
import org.umamo.interop.cmo3.Cmo3Export
import org.umamo.interop.cmo3.Cmo3Import
import org.umamo.interop.ExportNotice
import org.umamo.interop.moc3.Moc3Sidecars
import org.umamo.render.restMeshesToCanvasSpace
import org.umamo.render.canvasToParentSpaceFor
import org.umamo.runtime.model.*
import java.nio.file.Files
import java.nio.file.Path
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max

private fun smoothLid(value: Float): Float = value.coerceIn(0f, 1f).let { it * it * (3f - 2f * it) }

/** Alpha measurements are geometry guides only; antialias pixels and original RGB stay intact. */
private fun featureLine(layer: ClassifiedLayer, edge: Int = 0): (Float) -> Float {
  val raster = layer.source.raster
  val raw = FloatArray(raster.width) { Float.NaN }
  for (x in raw.indices) {
    var total = 0f; var sum = 0f; var first = -1; var last = -1
    for (y in 0 until raster.height) {
      val a = (raster.rgba[(y * raster.width + x) * 4 + 3].toInt() and 255).toFloat()
      if (a >= 32) { if (first < 0) first = y; last = y }
      total += a; sum += (y + .5f) * a
    }
    if (total > 0 && (edge == 0 || first >= 0)) raw[x] = layer.source.bounds.top + when (edge) { -1 -> first + .5f; 1 -> last + .5f; else -> sum / total }
  }
  val first = raw.indexOfFirst { it.isFinite() }; require(first >= 0)
  for (x in 0 until first) raw[x] = raw[first]
  var previous = first
  for (x in first + 1 until raw.size) if (raw[x].isFinite()) {
    for (i in previous + 1 until x) raw[i] = raw[previous] + (raw[x] - raw[previous]) * (i - previous) / (x - previous)
    previous = x
  }
  for (x in previous + 1 until raw.size) raw[x] = raw[previous]
  // Low-pass tiny extraction residuals instead of transferring a jagged alpha centroid to the lid.
  val line = FloatArray(raw.size) { x -> (-3..3).sumOf { d -> raw[(x+d).coerceIn(raw.indices)].toDouble() * (4-abs(d)) }.toFloat() / 16f }
  return { sourceX ->
    val x = (sourceX-layer.source.bounds.left).coerceIn(0f,line.lastIndex.toFloat())
    val i=x.toInt(); line[i]+(line[minOf(i+1,line.lastIndex)]-line[i])*(x-i)
  }
}

/** All vertices in a triangle lie in two X columns. A shared monotonic vertical map then
 * preserves orientation even for a curved seam; irregular sliver triangles did not. */
private fun columnMesh(drawable: Drawable, layer: ClassifiedLayer, frame: ReferenceFrame): DrawableMesh {
  val original = requireNotNull(drawable.mesh)
  val xs = original.positions.filterIndexed { i,_ -> i%2==0 }; val ys = original.positions.filterIndexed { i,_ -> i%2==1 }
  val us = original.uvs.filterIndexed { i,_ -> i%2==0 }; val vs = original.uvs.filterIndexed { i,_ -> i%2==1 }
  fun affine(axis: Int): Pair<Float,Float> {
    val p=if(axis==0)xs else ys; val v=if(axis==0)us else vs
    val lo=p.indices.minBy { p[it] }; val hi=p.indices.maxBy { p[it] }
    val a=(v[hi]-v[lo])/(p[hi]-p[lo]); val b=v[lo]-a*p[lo]
    require(p.indices.all { abs(a*p[it]+b-v[it])<.00001f }) { "Feature texture is not an affine source mapping" }
    return a to b
  }
  val (ux,uo)=affine(0); val (vy,vo)=affine(1)
  val bounds=layer.source.bounds
  val left=floor(bounds.left/3f)*3f; val right=ceil((bounds.left+bounds.width)/3f)*3f
  require(bounds.left-left<=2f && right-(bounds.left+bounds.width)<=2f){"Eye columns exceed the unchanged atlas's two-pixel transparent padding"}
  val columns=((right-left)/3f).toInt(); val rows=4
  val positions=FloatArray((columns+1)*(rows+1)*2); val uvs=FloatArray(positions.size)
  for(r in 0..rows)for(c in 0..columns){
    val i=(r*(columns+1)+c)*2
    positions[i]=(left+c*3f-frame.left)/frame.width
    positions[i+1]=(bounds.top+bounds.height*r.toFloat()/rows-frame.top)/frame.height
    uvs[i]=ux*positions[i]+uo;uvs[i+1]=vy*positions[i+1]+vo
  }
  val indices=IntArray(columns*rows*6);var at=0
  for(r in 0 until rows)for(c in 0 until columns){val a=r*(columns+1)+c;for(v in intArrayOf(a,a+1,a+columns+1,a+1,a+columns+2,a+columns+1))indices[at++]=v}
  return DrawableMesh(positions,uvs,indices)
}

private fun naturalEyelidModel(model: PuppetModel, layers: Map<String,ClassifiedLayer>): PuppetModel {
  val frame=referenceHeadFrame(model)
  val replacements=mutableMapOf<DrawableId,Drawable>()
  for((side,key)in listOf("left" to "L","right" to "R")){
    val whiteLayer=layers.getValue("eye-white-$side");val bounds=whiteLayer.source.bounds
    val top=featureLine(whiteLayer,-1);val bottom=featureLine(whiteLayer,1)
    val upper=featureLine(layers.getValue("eyelash-upper-$side"));val lower=featureLine(layers.getValue("eyelash-lower-$side"))
    val parameter=ParameterId("ParamEye${key}Open")
    val axis=KeyformAxis(parameter,floatArrayOf(0f,.25f,.5f,.75f,1f))
    // The closure follows the lower aperture; the lower lid travels only 12% of the opening.
    fun seam(x:Float):Float=bottom(x)-.12f*(bottom(x)-top(x))
    fun weight(x:Float):Float=smoothLid((x-(bounds.left-14f))/14f)*smoothLid((bounds.left+bounds.width+14f-x)/14f)
    for(prefix in listOf("eye-white","eyelash-upper","eyelash-lower")){
      val original=model.drawables.single { it.name.trim().lowercase()=="$prefix-$side" }
      val mesh=columnMesh(original,layers.getValue("$prefix-$side"),frame)
      val cells=axis.keys.mapIndexed { index,open ->
        val closure=1f-open;val delta=FloatArray(mesh.positions.size)
        for(i in mesh.positions.indices step 2){
          val x=frame.left+mesh.positions[i]*frame.width;val y=frame.top+mesh.positions[i+1]*frame.height
          val amount=closure*weight(x)
          val target=when(prefix){
            "eye-white" -> seam(x)+.012f*(y-(top(x)+bottom(x))*.5f)
            "eyelash-upper" -> seam(x)+.78f*(y-upper(x))
            else -> seam(x)+.5f*(y-lower(x))
          }
          delta[i+1]=(target-y)*amount/frame.height
        }
        // Each stripe uses a positive vertical scale; assert the actual exported triangles too.
        val moved=FloatArray(mesh.positions.size){mesh.positions[it]+delta[it]}
        for(t in mesh.indices.indices step 3){
          val a=mesh.indices[t]*2;val b=mesh.indices[t+1]*2;val c=mesh.indices[t+2]*2
          fun area(p:FloatArray)=(p[b]-p[a])*(p[c+1]-p[a+1])-(p[b+1]-p[a+1])*(p[c]-p[a])
          require(area(moved)/area(mesh.positions)>.005f){"Natural eyelid inverted a column triangle"}
        }
        KeyformCell(intArrayOf(index),MeshDeltaForm(delta))
      }
      val channels=original.channelGrids.gridsByChannel.toMutableMap().apply { remove(FormChannel.OPACITY) }
      if(prefix=="eye-white")channels[FormChannel.OPACITY]=terminalOcclusion(parameter)
      replacements[original.id]=original.copy(mesh=mesh,geometryGrid=KeyformGrid(listOf(axis),cells),channelGrids=ChannelGrids(channels),opacity=1f)
    }
    val iris=model.drawables.single{it.name.trim().lowercase()=="iris-$side"}
    replacements[iris.id]=iris.copy(channelGrids=ChannelGrids(iris.channelGrids.gridsByChannel+mapOf(FormChannel.OPACITY to terminalOcclusion(parameter))))
  }
  return model.copy(drawables=model.drawables.map { replacements[it.id]?:it })
}

/** Only the subpixel terminal sliver is hidden; the eye never dissolves through the last quarter. */
private fun terminalOcclusion(parameter:ParameterId):KeyformGrid<ChannelValue> = KeyformGrid(
  listOf(KeyformAxis(parameter,floatArrayOf(0f,.003f,1f))),
  listOf(KeyformCell(intArrayOf(0),ChannelValue.Scalar(0f)),KeyformCell(intArrayOf(1),ChannelValue.Scalar(1f)),KeyformCell(intArrayOf(2),ChannelValue.Scalar(1f))))

fun exportNaturalEyelids(result:PipelineResult, output:Path, config:PipelineConfig){
  val preview=result.previewModel;val before=preview.rig.puppet
  val layers=result.analysis.layers.associateBy{it.source.name.trim().lowercase()}
  val model=naturalEyelidModel(before,layers)
  require(model.parameters===before.parameters && model.deformers===before.deformers)
  for(item in before.drawables)if(!listOf("eye-white-","eyelash-upper-","eyelash-lower-","iris-").any{item.name.startsWith(it)})require(model.drawables.single{it.id==item.id}===item)
  val export=restMeshesToCanvasSpace(model,mapOf(ParameterId("ParamMouthOpenY") to 1f))
  val manifest=Moc3.readModel3(Files.readString(output.resolve("akari.model3.json")))
  val pages=manifest.fileReferences.textures.map{Moc3Sidecars.AtlasPage(it,Files.readAllBytes(output.resolve(it)))}
  val sidecars=buildList{
    manifest.fileReferences.physics?.let{add(Moc3Sidecars.PassThroughSidecar(Moc3Sidecars.SidecarKind.Physics,it,Files.readString(output.resolve(it))))}
    for(entry in manifest.fileReferences.motions.orEmpty().values.flatten())add(Moc3Sidecars.PassThroughSidecar(Moc3Sidecars.SidecarKind.Motion,entry.file,Files.readString(output.resolve(entry.file))))
  }
  val bundle=Moc3Sidecars.bundle(export,"akari",pages=pages,sidecars=sidecars,source=manifest,canvasToParentSpace=canvasToParentSpaceFor(export),options=config.moc3ExportOptions())
  for(file in bundle.files)Files.write(output.resolve(file.name),file.bytes)
  // Reconcile onto this build's retained editable graph, preserving original layered artwork,
  // atlas resources and physics GUID references. Do not substitute an older CMO3 for the new MOC.
  val editable=Cmo3.read(Files.readAllBytes(output.resolve("akari.cmo3")))
  val editableBase=Cmo3Import.fromModelSource(editable.root as CModelSource)
  // CMO3 uses its own persistent atlas-tile identities. Keep that graph's identities rather
  // than asking reconciliation to rebind them to the pipeline's transient art-0 names.
  val editablePose=editableBase.copy(drawables=editableBase.drawables.map { item ->
    if(!listOf("eye-white-","eyelash-upper-","eyelash-lower-","iris-").any{item.name.startsWith(it)})item
    else export.drawables.single{it.id==item.id}.let{revised->item.copy(mesh=revised.mesh,geometryGrid=revised.geometryGrid,channelGrids=revised.channelGrids,opacity=revised.opacity)}
  })
  val editableReport=Cmo3Export.apply(editablePose,editable)
  // This notice records the six deliberately replaced base meshes; it is not a dropped
  // edit. Any unsupported field/atlas rebind notice is a real export failure.
  require(editableReport.notices.all{it is ExportNotice.WeldDivergence}){"Unexpected editable-model export notice: ${editableReport.notices}"}
  val editableBytes=Cmo3.write(editable)
  val roundTrip=Cmo3Import.fromModelSource(Cmo3.read(editableBytes).root as CModelSource)
  require(roundTrip.parameters.map{it.id}.toSet()==model.parameters.map{it.id}.toSet())
  fun sameArray(expected:FloatArray,actual:FloatArray,label:String){require(expected.size==actual.size&&expected.indices.all{abs(expected[it]-actual[it])<.00001f}){label}}
  for(item in export.drawables){
    val actual=roundTrip.drawables.single{it.id==item.id}
    require(actual.mesh?.vertexCount==item.mesh?.vertexCount){"CMO3 lost revised eyelid topology"}
    require(actual.maskedBy==item.maskedBy){"CMO3 lost native iris clipping"}
    val expectedMesh=requireNotNull(item.mesh);val actualMesh=requireNotNull(actual.mesh)
    sameArray(expectedMesh.positions,actualMesh.positions,"CMO3 changed the editable rest geometry: ${item.name}")
    sameArray(expectedMesh.uvs,actualMesh.uvs,"CMO3 changed the retained atlas UV frame: ${item.name}")
    require(expectedMesh.indices.contentEquals(actualMesh.indices)){"CMO3 changed the editable triangle indices"}
    if(listOf("eye-white-","eyelash-upper-","eyelash-lower-").any{item.name.startsWith(it)}){
      val expectedGrid=requireNotNull(item.geometryGrid);val actualGrid=requireNotNull(actual.geometryGrid)
      for(cell in expectedGrid.cells){
        val values=expectedGrid.axes.mapIndexed{index,axis->axis.parameterId to axis.keys[cell.coordinate[index]]}.toMap()
        val restored=actualGrid.cells.single{candidate->actualGrid.axes.indices.all{index->actualGrid.axes[index].keys[candidate.coordinate[index]]==values[actualGrid.axes[index].parameterId]}}
        require(restored.form.positionDeltas.size==cell.form.positionDeltas.size)
        require(cell.form.positionDeltas.indices.all{abs(cell.form.positionDeltas[it]-restored.form.positionDeltas[it])<.00001f}){"CMO3 lost revised eyelid keyforms"}
      }
    }
    if(item.name.startsWith("eye-white-")||item.name.startsWith("iris-")){
      val opacity=requireNotNull(actual.channelGrids[FormChannel.OPACITY])
      require(opacity.axes.size==1)
      for((key,value)in listOf(0f to 0f,.003f to 1f,1f to 1f)){
        val index=opacity.axes.single().keys.indexOfFirst{it==key};require(index>=0){"CMO3 lost terminal occlusion key"}
        require((opacity.cells.single{it.coordinate.single()==index}.form as ChannelValue.Scalar).value==value){"CMO3 changes terminal occlusion opacity"}
      }
    }
  }
  Files.write(output.resolve("akari.cmo3"),editableBytes)
  val metadataPath=output.resolve("akari.psd2live.json");val metadata=Json.parseToJsonElement(Files.readString(metadataPath)).jsonObject
  Files.writeString(metadataPath,JsonObject(metadata+mapOf("petpalEyelidRevision" to JsonPrimitive("natural-v12"),"editableCandidate" to JsonPrimitive("matching CMO3 topology/keyforms/clipping codec readback; official Editor unverified"),"editableExportNotices" to JsonArray(editableReport.notices.map{JsonPrimitive(it.toString())}))).toString())
  println("Natural eyelids: same source texture/parameters/head/body; local column meshes, shared lower closure, terminal-only occlusion; matching CMO3 topology/keyforms/clipping readback passed")
}
