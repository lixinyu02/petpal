/** PSD source packaging only: retains generated RGBA pixels; no painted artwork. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PNG} from 'pngjs';
import {writePsdBuffer,readPsd} from 'ag-psd';

const project=path.resolve(import.meta.dirname,'../..');
const directory=path.join(project,'outputs/avatars/akari-cubism-v2');
const baseline=path.join(project,'outputs/avatars/akari-cubism');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const layout=JSON.parse(fs.readFileSync(path.join(directory,'layout.json'),'utf8'));
const original=JSON.parse(fs.readFileSync(path.join(baseline,'layout.json'),'utf8'));
if(layout.width!==original.width||layout.height!==original.height)throw new Error('Original character canvas must be preserved');
if(layout.body?.file!=='body-continuous.png')throw new Error('Continuous body source must match the reviewed asset');
if(!Array.isArray(layout.body.source)||!Array.isArray(layout.body.target))throw new Error('Body crop and placement required');
const imageFile=path.join(directory,'body-continuous.png');
const bodyBytes=fs.readFileSync(imageFile), body=PNG.sync.read(bodyBytes);
const [sx,sy,sw,sh]=layout.body.source, [left,top,width,height]=layout.body.target;
if([sx,sy,sw,sh,left,top,width,height].some(n=>!Number.isInteger(n)||n<0)||!sw||!sh||!width||!height||sx+sw>body.width||sy+sh>body.height||left+width>layout.width||top+height>layout.height)throw new Error('Invalid body bounds');
// Nearest sampling retains the source alpha exactly, as in the classic packer.
const pixels=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const from=((sy+Math.floor(y*sh/height))*body.width+sx+Math.floor(x*sw/width))*4;
  pixels.set(body.data.subarray(from,from+4),(y*width+x)*4);
}
const children=[], sources=[];
for(const item of original.layers){
  if(item.name==='neck')continue;
  if(item.name==='topwear'){
    children.push({name:item.name,left,top,imageData:{width,height,data:pixels}});
    sources.push({name:item.name,file:'body-continuous.png',sha256:hash(bodyBytes),source:layout.body.source,target:layout.body.target});
  }else{
    const filename=path.join(baseline,'layers',item.name+'.png'), bytes=fs.readFileSync(filename), png=PNG.sync.read(bytes);
    if(png.width!==item.target[2]||png.height!==item.target[3])throw new Error('Original layer size differs');
    children.push({name:item.name,left:item.target[0],top:item.target[1],imageData:{width:png.width,height:png.height,data:new Uint8ClampedArray(png.data)}});
    sources.push({name:item.name,file:'../akari-cubism/layers/'+item.name+'.png',sha256:hash(bytes),target:item.target});
  }
}
if(children.length!==20||children.some(layer=>layer.name==='neck'))throw new Error('Continuous body must replace both conflicting layers');
function composite(visibleOnly){
  const output=new PNG({width:layout.width,height:layout.height});
  for(const layer of children){
    if(visibleOnly&&/^(eye close|mouth open|blush|tears)/.test(layer.name))continue;
    const image=layer.imageData;
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
      const from=(y*image.width+x)*4,to=((layer.top+y)*layout.width+layer.left+x)*4;
      const a=image.data[from+3]/255,b=output.data[to+3]/255,total=a+b*(1-a);
      if(total>0)for(let c=0;c<3;c++)output.data[to+c]=Math.round((image.data[from+c]*a+output.data[to+c]*b*(1-a))/total);
      output.data[to+3]=Math.round(total*255);
    }
  }
  return output;
}
const assembled=composite(false), neutral=composite(true);
const psd=writePsdBuffer({width:layout.width,height:layout.height,imageData:{width:layout.width,height:layout.height,data:new Uint8ClampedArray(assembled.data)},children},{generateThumbnail:false});
const parsed=readPsd(psd,{skipCompositeImageData:true,skipLayerImageData:true,skipThumbnail:true});
if(parsed.children.length!==20)throw new Error('PSD readback layer count mismatch');
fs.writeFileSync(path.join(directory,'akari.psd'),psd);
fs.writeFileSync(path.join(directory,'neutral-layout.png'),PNG.sync.write(neutral));
fs.writeFileSync(path.join(directory,'pack-receipt.json'),JSON.stringify({schema:1,method:'Original face/hair layer reuse; generated continuous body; mechanical RGBA sampling and PSD encoding only',bodySha256:hash(bodyBytes),psdSha256:hash(psd),canvas:[layout.width,layout.height],layers:sources},null,2)+'\n');
console.log(JSON.stringify({layers:children.length,psdBytes:psd.length,psdSha256:hash(psd)}));
