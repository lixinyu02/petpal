/** Mechanical feature separation. All colors originate in reviewed artwork; no features are painted. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { initializeCanvas, readPsd, writePsdBuffer } from 'ag-psd';

const root = path.resolve(import.meta.dirname, '../..');
const out = path.join(root, 'outputs/avatars/akari-cubism-v11');
const art = path.join(root, 'artwork/akari/features-v11');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [];
function load(file) { const bytes = fs.readFileSync(path.join(root, file)); sources.push({ file, sha256: hash(bytes) }); return PNG.sync.read(bytes); }
const original = load('artwork/akari/idle.png');
const clean = load('artwork/akari/features-v11/clean-underpaint.png');
const whiteR = load('outputs/avatars/akari-cubism/layers/eyewhite-r.png');
const whiteL = load('outputs/avatars/akari-cubism/layers/eyewhite-l.png');
const { width, height } = original;
if (width !== 1024 || height !== 1536 || clean.width !== width || clean.height !== height) throw new Error('Unexpected source canvas');
initializeCanvas(() => { throw new Error('Canvas painting is not used'); }, (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }));
const psdSource = 'outputs/avatars/akari-cubism-v7/akari.psd';
const psdBytes = fs.readFileSync(path.join(root, psdSource));
sources.push({ file: psdSource, sha256: hash(psdBytes) });
const sourcePsd = readPsd(psdBytes, { useImageData: true, skipThumbnail: true });
const layers = [];
const receipts = [];
const smooth = v => { const t = Math.max(0, Math.min(1, v)); return t * t * (3 - 2 * t); };
function polygonMask(points, feather = 1, expand = 0) {
  return (x, y) => {
    let inside = false, distance = Infinity;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[j], [bx, by] = points[i];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
      const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      distance = Math.min(distance, Math.hypot(x - ax - u * (bx - ax), y - ay - u * (by - ay)));
    }
    return smooth(((inside ? distance : -distance) + expand + .5) / feather);
  };
}
const specs = [
  { side: 'right', white: whiteR, aperture: [[376,389],[383,377],[395,368],[413,361],[435,361],[452,367],[462,378],[464,397],[454,408],[433,418],[411,418],[394,411],[383,401]],
    iris: [[405,366],[414,361],[437,362],[451,370],[456,385],[454,405],[443,414],[426,418],[411,413],[402,401],[397,380]],
    upper: [[348,387],[358,379],[365,365],[372,355],[389,349],[397,341],[407,347],[415,341],[427,343],[440,349],[451,353],[468,367],[479,385],[466,395],[454,381],[444,371],[427,366],[410,369],[394,376],[385,390],[384,407],[375,400],[363,391]],
    lower: [[378,395],[391,405],[409,412],[428,415],[447,410],[459,403],[459,415],[447,421],[434,425],[420,425],[405,421],[391,417],[382,409]],
    brow: [[365,320],[381,311],[404,304],[430,298],[446,299],[456,307],[441,308],[425,306],[403,312],[382,320],[366,327]],
    erase: [[349,386],[359,371],[366,356],[387,347],[400,339],[419,339],[440,346],[457,354],[477,375],[475,398],[459,418],[435,428],[411,426],[389,419],[376,405],[364,393]],
    whiteBounds: [376,361,88,58] },
  { side: 'left', white: whiteL, aperture: [[558,368],[565,352],[579,340],[601,338],[620,343],[635,352],[645,361],[641,377],[627,390],[608,397],[582,398],[568,390],[562,380]],
    iris: [[567,351],[577,342],[602,339],[615,346],[622,364],[619,386],[607,396],[579,397],[568,387],[563,369]],
    upper: [[541,365],[544,351],[549,340],[561,330],[576,323],[584,316],[595,321],[603,320],[612,315],[622,326],[634,333],[650,341],[669,349],[668,352],[657,360],[647,369],[638,371],[626,357],[613,346],[591,344],[574,353],[562,368],[551,379]],
    lower: [[562,377],[572,388],[585,392],[608,392],[627,384],[644,372],[643,386],[630,396],[612,402],[585,402],[574,398],[563,390]],
    brow: [[540,291],[551,285],[572,280],[595,281],[615,286],[638,299],[628,300],[611,292],[591,289],[574,288],[554,292],[540,297]],
    erase: [[541,363],[549,345],[565,330],[581,317],[593,323],[610,316],[626,330],[649,341],[670,351],[657,368],[648,387],[629,400],[609,405],[581,406],[565,397],[556,382]],
    whiteBounds: [558,338,88,61] },
];
for (const spec of specs) for (const key of ['aperture','iris','upper','lower','brow','erase']) spec[key + 'Mask'] = polygonMask(spec[key], key === 'brow' || key === 'upper' || key === 'lower' ? 2 : 1, ['upper','lower','brow','iris'].includes(key) ? 3 : 0);
for (const spec of specs) spec.eraseMask = (x,y) => Math.max(spec.upperMask(x,y),spec.lowerMask(x,y),spec.apertureMask(x,y),spec.irisMask(x,y));
const face = sourcePsd.children.find(item => item.name === 'face');
if (!face?.imageData) throw new Error('Missing base face');
const originalFace = Buffer.from(face.imageData.data);
for (let y = 0; y < face.imageData.height; y++) for (let x = 0; x < face.imageData.width; x++) {
  const px = face.left + x, py = face.top + y;
  const amount = Math.max(...specs.map(spec => Math.max(spec.eraseMask(px, py), spec.browMask(px, py))));
  if (!amount) continue;
  const at = (y * face.imageData.width + x) * 4, from = (py * width + px) * 4;
  for (let c = 0; c < 3; c++) face.imageData.data[at + c] = Math.round(originalFace[at + c] * (1 - amount) + clean.data[from + c] * amount);
}
function addExisting(name) { const layer = sourcePsd.children.find(item => item.name === name); layers.push(layer); receipts.push({ name, bounds: [layer.left,layer.top,layer.imageData.width,layer.imageData.height], defaultVisible: !layer.hidden, source: psdSource, unchanged: name !== 'face' }); }
for (const name of ['topwear','face','front hair 1','front hair 2']) addExisting(name);
function composite() {
  const image = new PNG({ width, height });
  for (const layer of layers) {
    if (layer.hidden) continue;
    const p = layer.imageData;
    // Native MOC iris clipping also removes its antialiased edge pixels. Use
    // exactly that coverage while recovering the eyelash residual, otherwise
    // a stroke owned only by the unmasked iris becomes a white rim at runtime.
    const clip = layer.name.startsWith('iris-') ? layers.find(candidate => candidate.name === layer.name.replace('iris-', 'eye-white-')) : undefined;
    for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
      const a = (y*p.width+x)*4, b = ((y+layer.top)*width+x+layer.left)*4;
      const clipX = x + layer.left - (clip?.left || 0), clipY = y + layer.top - (clip?.top || 0);
      const coverage = !clip ? 1 : clipX < 0 || clipY < 0 || clipX >= clip.imageData.width || clipY >= clip.imageData.height ? 0 : clip.imageData.data[(clipY * clip.imageData.width + clipX) * 4 + 3] / 255;
      const foreground = p.data[a+3]/255*coverage, background = image.data[b+3]/255, total = foreground+background*(1-foreground);
      if (total) for (let c=0;c<3;c++) image.data[b+c]=Math.round((p.data[a+c]*foreground+image.data[b+c]*background*(1-foreground))/total);
      image.data[b+3]=Math.round(total*255);
    }
  }
  return image;
}
function make(name, pixels, metadata = {}) {
  let l=width,t=height,r=0,b=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(pixels[(y*width+x)*4+3]){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x+1);b=Math.max(b,y+1);}
  if(r<=l||b<=t)throw new Error('Empty feature: '+name);
  const w=r-l,h=b-t,data=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++)data.set(pixels.subarray(((t+y)*width+l)*4,((t+y)*width+r)*4),y*w*4);
  const layer={name,left:l,top:t,hidden:false,imageData:{width:w,height:h,data}};
  layers.push(layer); receipts.push({name,bounds:[l,t,w,h],defaultVisible:true,pixelsSha256:hash(data),...metadata});
  const png=new PNG({width:w,height:h});png.data=Buffer.from(data);fs.writeFileSync(path.join(art,name+'.png'),PNG.sync.write(png));
  return layer;
}
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(art,{recursive:true});
const base = composite();fs.writeFileSync(path.join(out,'clean-layout.png'),PNG.sync.write(base));
for(const spec of specs){
  const p=new Uint8ClampedArray(width*height*4),[l,t,w,h]=spec.whiteBounds;
  for(let y=t;y<t+h;y++)for(let x=l;x<l+w;x++){
    const coverage=spec.apertureMask(x,y);if(!coverage)continue;
    const at=(y*width+x)*4;
    const sx=Math.min(spec.white.width-1,Math.max(0,Math.round((x-l)/w*(spec.white.width-1)))),sy=Math.min(spec.white.height-1,Math.max(0,Math.round((y-t)/h*(spec.white.height-1))));
    const from=(sy*spec.white.width+sx)*4;
    // The existing independent white paints the previously occluded region only.
    const donor=spec.irisMask(x,y)>0?spec.white.data:original.data,index=donor===original.data?at:from;
    for(let c=0;c<3;c++)p[at+c]=donor[index+c];p[at+3]=Math.round(coverage*255);
  }
  make('eye-white-'+spec.side,p,{source:'original aperture; previous independent eye-white under original iris',aperture:spec.aperture});
  residual('iris-'+spec.side,spec.irisMask,{clippedBy:'eye-white-'+spec.side});
}
// Color-to-alpha removal recovers the original antialiased strokes against the
// current underpaint. This is inverse compositing, not synthetic line drawing.
function residual(name,mask,metadata={}){
  const below=composite(),p=new Uint8ClampedArray(width*height*4);
  for(let y=270;y<433;y++)for(let x=342;x<675;x++){
    const coverage=mask(x,y);if(!coverage)continue;
    const at=(y*width+x)*4;let a=0;
    for(let c=0;c<3;c++){const o=original.data[at+c],b=below.data[at+c];a=Math.max(a,o<b?(b-o)/Math.max(1,b):(o-b)/Math.max(1,255-b));}
    // One extra alpha step avoids out-of-range unmatting from rounding.
    a=Math.min(1,Math.ceil(a*255)/255);if(a<1/255)continue;
    for(let c=0;c<3;c++)p[at+c]=Math.round(Math.max(0,Math.min(255,(original.data[at+c]-below.data[at+c]*(1-a))/a)));
    p[at+3]=Math.round(a*255);
  }
  return make(name,p,{source:'original pixels recovered with inverse source-over alpha against clean underpaint',...metadata});
}
for(const spec of specs){residual('eyelash-upper-'+spec.side,spec.upperMask);residual('eyelash-lower-'+spec.side,spec.lowerMask);residual('eyebrow-'+spec.side,spec.browMask);}
for(const name of ['mouth-a','mouth-o'])addExisting(name);
const neutral=composite();
fs.writeFileSync(path.join(out,'neutral-layout.png'),PNG.sync.write(neutral));
function crop(image,x,y,w,h,file){const p=new PNG({width:w,height:h});PNG.bitblt(image,p,x,y,w,h,0,0);fs.writeFileSync(path.join(out,file),PNG.sync.write(p));}
crop(neutral,325,255,380,300,'neutral-face-crop.png');crop(original,325,255,380,300,'original-face-crop.png');crop(base,325,255,380,300,'clean-face-crop.png');
const packed=writePsdBuffer({width,height,imageData:{width,height,data:new Uint8ClampedArray(neutral.data)},children:[...layers].reverse()},{generateThumbnail:false});
const read=readPsd(packed,{useImageData:true,skipThumbnail:true,skipCompositeImageData:true});
for(const layer of layers){const actual=read.children.find(x=>x.name===layer.name);if(!actual||actual.left!==layer.left||actual.top!==layer.top||!!actual.hidden!==!!layer.hidden||!Buffer.from(actual.imageData.data).equals(Buffer.from(layer.imageData.data)))throw new Error('PSD readback failed: '+layer.name);}
let unchangedOutsideFeatures=true,changedPixels=0,absoluteError=0,maxError=0,visiblePixels=0;
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=(y*width+x)*4;if(!original.data[at+3]||!neutral.data[at+3])continue;visiblePixels++;let change=0;for(let c=0;c<3;c++){const d=Math.abs(neutral.data[at+c]-original.data[at+c]);change=Math.max(change,d);absoluteError+=d;maxError=Math.max(maxError,d);}
  if(change>1&&original.data[at+3]&&neutral.data[at+3]){changedPixels++;if(!specs.some(spec=>spec.eraseMask(x,y)||spec.browMask(x,y)||spec.apertureMask(x,y)||spec.upperMask(x,y)||spec.lowerMask(x,y)||spec.irisMask(x,y)))unchangedOutsideFeatures=false;}
}
if(!unchangedOutsideFeatures)throw new Error('Pixels outside feature masks changed');
if(maxError>1)throw new Error('Neutral visible pixels differ by more than integer alpha rounding');
fs.writeFileSync(path.join(out,'akari.psd'),packed);
const receipt={schema:1,profile:'reference-features',method:'Original portrait mechanical feature separation; generated clean underpaint only inside bounded eye/brow masks; inverse alpha recovery of original strokes including native iris eye-white clipping; existing eye-white underpaint; no procedural feature drawing',canvas:[width,height],sources,layers:receipts,psdSha256:hash(packed),readbackExact:true,neutralComparison:{nativeIrisClipSimulated:true,unchangedOutsideFeatures,changedPixels,maxError,meanAbsoluteError:absoluteError/(visiblePixels*3),visiblePixels},boundary:'PSD pixel/layer and reference-resolution iris clip simulation only; actual Core mask filtering, native rig deformation, and browser verification are separate'};
fs.writeFileSync(path.join(out,'pack-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({layers:layers.length,psdSha256:receipt.psdSha256,neutralComparison:receipt.neutralComparison}));
