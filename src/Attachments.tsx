import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { api, apiBlob, getSessionEpoch, isSessionChanged, type Attachment } from './api';
import './attachments.css';

type DraftImage = Attachment & { previewUrl:string };
const formats = ['image/png','image/jpeg','image/webp'];
let loadingImages=0;
const imageWaiters=new Set<()=>void>();
async function imageSlot(signal:AbortSignal) {
  while(loadingImages>=3){
    await new Promise<void>((resolve,reject)=>{
      const ready=()=>{imageWaiters.delete(ready);signal.removeEventListener('abort',abort);resolve();};
      const abort=()=>{imageWaiters.delete(ready);signal.removeEventListener('abort',abort);reject(signal.reason);};
      imageWaiters.add(ready);signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();
    });
  }
  signal.throwIfAborted();loadingImages++;
  return ()=>{loadingImages--;for(const ready of imageWaiters)ready();};
}
export function useAttachments() {
  const [items,setItems]=useState<DraftImage[]>([]),[uploading,setUploading]=useState(false),[error,setError]=useState('');
  const refs=useRef<DraftImage[]>([]), generation=useRef(0), controller=useRef<AbortController|null>(null), inputRef=useRef<HTMLInputElement>(null);
  const clear=()=>{generation.current++;controller.current?.abort();controller.current=null;for(const image of refs.current)URL.revokeObjectURL(image.previewUrl);refs.current=[];setItems([]);setUploading(false);setError('');};
  useEffect(()=>()=>{generation.current++;controller.current?.abort();for(const image of refs.current)URL.revokeObjectURL(image.previewUrl);},[]);
  async function upload(files:File[]) {
    if(controller.current||!files.length)return;
    setError('');
    if(refs.current.length+files.length>4){setError('每条消息最多附上 4 张图片。');return;}
    if(files.some(file=>!formats.includes(file.type)||file.size>8*1024**2)){setError('请选择 8 MB 以内的 PNG、JPG 或 WebP 图片。');return;}
    const epoch=getSessionEpoch(),ticket=++generation.current,abort=new AbortController();controller.current=abort;setUploading(true);
    try {
      for(const file of files){
        const attachment=await api<Attachment>('/attachments',{method:'POST',headers:{'Content-Type':file.type},body:file,signal:abort.signal});
        if(ticket!==generation.current||epoch!==getSessionEpoch()||abort.signal.aborted)return;
        refs.current=[...refs.current,{...attachment,previewUrl:URL.createObjectURL(file)}];setItems(refs.current);
      }
    }catch(error){if(ticket===generation.current&&!isSessionChanged(error)&&(error as Error).name!=='AbortError')setError((error as Error).message);}
    finally{if(ticket===generation.current){controller.current=null;setUploading(false);}}
  }
  const remove=(id:string)=>{const image=refs.current.find(item=>item.id===id);if(image)URL.revokeObjectURL(image.previewUrl);refs.current=refs.current.filter(item=>item.id!==id);setItems(refs.current);};
  const change=(event:ChangeEvent<HTMLInputElement>)=>{const files=Array.from(event.target.files||[]);event.target.value='';void upload(files);};
  return {items,uploading,error,clear,remove,upload,inputRef,change};
}

export function AttachmentInput({ value,disabled=false }: {value:ReturnType<typeof useAttachments>;disabled?:boolean}) {
  return <><input ref={value.inputRef} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="选择消息图片" onChange={value.change} className="image-file-input" disabled={disabled||value.uploading}/><button className="attach-image" type="button" aria-label="上传图片" title="PNG、JPG、WebP · 每张 8 MB · 最多 4 张" disabled={disabled||value.uploading||value.items.length>=4} onClick={()=>value.inputRef.current?.click()}>{value.uploading?<Loader2 className="spin" size={18}/>:<ImagePlus size={18}/>}<span>{value.uploading?'上传中':'图片'}</span></button></>;
}
export function AttachmentDrafts({value}:{value:ReturnType<typeof useAttachments>}) {
  return <>{value.items.length>0&&<div className="attachment-drafts">{value.items.map(item=><div key={item.id}><img src={item.previewUrl} alt="待发送图片"/><button type="button" aria-label="移除图片" onClick={()=>value.remove(item.id)}><X size={12}/></button></div>)}</div>}{value.error&&<p className="attachment-error" role="alert">{value.error}</p>}</>;
}
function SavedImage({attachment}:{attachment:Attachment}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(false),[retry,setRetry]=useState(0),[visible,setVisible]=useState(false),[expanded,setExpanded]=useState(false);
  const container=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!container.current)return;
    if(!('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{rootMargin:'250px'});observer.observe(container.current);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{if(!expanded)return;const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setExpanded(false);};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[expanded]);
  useEffect(()=>{
    if(!visible&&!expanded)return;
    const controller=new AbortController();let objectUrl='';setError(false);setUrl('');
    void (async()=>{const release=await imageSlot(controller.signal);try{return await apiBlob(`/attachments/${encodeURIComponent(attachment.id)}`,{signal:controller.signal});}finally{release();}})().then(blob=>{if(controller.signal.aborted)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);}).catch(error=>{if(!controller.signal.aborted&&!isSessionChanged(error))setError(true);});
    return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[attachment.id,retry,visible]);
  return <div ref={container} className="message-image-slot">{url?<button type="button" className="message-image" title="查看图片" onClick={()=>setExpanded(true)}><img src={url} alt={attachment.name||'消息图片'}/></button>:<button className="message-image-placeholder" disabled={!error} onClick={()=>setRetry(value=>value+1)}>{error?'图片加载失败 · 重试':visible?<Loader2 size={18} className="spin"/>:'图片'}</button>}{expanded&&url&&<div className="image-preview-backdrop" role="dialog" aria-modal="true" aria-label="查看消息图片" onClick={()=>setExpanded(false)}><button autoFocus type="button" aria-label="关闭图片" onClick={()=>setExpanded(false)}><X size={22}/></button><img src={url} alt={attachment.name||'消息图片'} onClick={event=>event.stopPropagation()}/></div>}</div>;
}
export function MessageImages({items}:{items?:Attachment[]}) {
  if(!items?.length)return null;
  return <div className="message-images">{items.map(item=><SavedImage key={item.id} attachment={item}/>)}</div>;
}
