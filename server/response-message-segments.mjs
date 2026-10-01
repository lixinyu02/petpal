import {createHash} from 'node:crypto';

const invalid=()=>new Error('Responses 分段消息格式无效，请检查服务兼容性。');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x1f\x7f]/.test(value);
const index=value=>Number.isSafeInteger(value)&&value>=0&&value<512;
const emptyAnnotations=part=>part.annotations===undefined||Array.isArray(part.annotations)&&part.annotations.length===0;
export const needsCumulativeMessageMapping=model=>typeof model==='string'&&/^(?:halogen-)?qwen(?:[0-9.-]|$)/i.test(model);

/** A narrow gateway compatibility mapping. Tools and their arguments are never rewritten. */
export class CumulativeMessageAdapter {
  constructor(){this.responseId='';this.bindings=new Map();this.sources=new Map();this.ids=new Map();this.completedOutput=null;}
  _added(value){
    const {item,output_index:position}=value;
    if(!index(position)||!object(item)||!identifier(item.id)||typeof item.type!=='string')throw invalid();
    const existing=this.bindings.get(position);
    if(existing){if(existing.sourceId!==item.id||existing.type!==item.type)throw invalid();return existing;}
    const prior=(this.sources.get(item.id)??[]).at(-1),owner=this.ids.get(item.id);
    const assistant=item.type==='message'&&item.role==='assistant';
    if(owner&&owner.sourceId!==item.id)throw invalid();
    if(prior&&(!assistant||!prior.assistant||!prior.done||prior.position>=position))throw invalid();
    if(prior&&(!Array.isArray(item.content)||item.content.length))throw invalid();
    const id=prior?'msg_petpal_'+createHash('sha256').update(JSON.stringify([this.responseId,item.id,position])).digest('hex').slice(0,40):item.id;
    if(this.ids.has(id))throw invalid();
    const binding={sourceId:item.id,id,position,type:item.type,assistant,prior,done:false,rawFinal:null,deltas:new Map()};
    this.bindings.set(position,binding);this.ids.set(id,binding);
    this.sources.set(item.id,[...this.sources.get(item.id)??[],binding]);
    return binding;
  }
  _reference(value){
    const binding=this.bindings.get(value.output_index);
    if(binding&&value.item_id!==binding.sourceId)throw invalid();
    return binding;
  }
  _text(binding,position,text){
    if(!binding.prior)return text;
    const prefix=binding.prior.rawFinal?.content?.[position];
    if(!index(position)||typeof text!=='string'||prefix?.type!=='output_text'||typeof prefix.text!=='string'||!binding.deltas.has(position)||text!==prefix.text+binding.deltas.get(position))throw invalid();
    return text.slice(prefix.text.length);
  }
  _item(binding,item){
    if(item.id!==binding.sourceId||item.type!==binding.type)throw invalid();
    if(!binding.prior)return item;
    if(item.role!=='assistant'||!Array.isArray(item.content)||item.content.length!==binding.prior.rawFinal.content.length)throw invalid();
    const content=item.content.map((part,position)=>{
      if(!object(part)||part.type!=='output_text'||!emptyAnnotations(part))throw invalid();
      return {...part,text:this._text(binding,position,part.text)};
    });
    return {...item,id:binding.id,content};
  }
  _output(output){
    if(!Array.isArray(output)||output.length>512)throw invalid();
    return output.map((item,position)=>{
      const binding=this.bindings.get(position);if(!binding)return item;
      if(item?.id!==binding.sourceId||item.type!==binding.type)throw invalid();
      if(binding.prior&&!binding.done)throw invalid();
      if(binding.rawFinal&&JSON.stringify(item)!==JSON.stringify(binding.rawFinal))throw invalid();
      return this._item(binding,item);
    });
  }
  map(value){
    if(!object(value)||typeof value.type!=='string')throw invalid();
    const type=value.type;
    if(type==='response.created'){
      if(!identifier(value.response?.id)||this.responseId)throw invalid();this.responseId=value.response.id;return value;
    }
    if(type==='response.output_item.added'){
      const binding=this._added(value);
      return binding.prior?{...value,item:{...value.item,id:binding.id}}:value;
    }
    if(type==='response.output_item.done'){
      const binding=this.bindings.get(value.output_index);if(!binding)return value;
      const item=this._item(binding,value.item);
      if(binding.assistant){
        if(value.item.role!=='assistant'||value.item.status!=='completed'||!Array.isArray(value.item.content))throw invalid();
        if(binding.rawFinal&&JSON.stringify(value.item)!==JSON.stringify(binding.rawFinal))throw invalid();
        binding.rawFinal=value.item;binding.done=true;
      }
      return binding.prior?{...value,item}:value;
    }
    if(['response.completed','response.done'].includes(type)){
      if(!object(value.response))throw invalid();
      const output=this._output(value.response.output);
      if(type==='response.completed')this.completedOutput=JSON.stringify(value.response.output);
      else if(this.completedOutput===null||this.completedOutput!==JSON.stringify(value.response.output))throw invalid();
      return output.some((item,position)=>item!==value.response.output[position])?{...value,response:{...value.response,output}}:value;
    }
    if(value.item_id!==undefined){
      const binding=this._reference(value);if(!binding?.assistant)return value;
      let mapped=value;
      if(type==='response.output_text.delta'){
        if(!index(value.content_index)||typeof value.delta!=='string'||binding.done)throw invalid();
        binding.deltas.set(value.content_index,(binding.deltas.get(value.content_index)??'')+value.delta);
      }else if(type==='response.output_text.done'){
        const text=this._text(binding,value.content_index,value.text);if(binding.prior)mapped={...mapped,text};
      }else if(type==='response.content_part.done'&&binding.prior){
        if(value.part?.type!=='output_text'||!emptyAnnotations(value.part))throw invalid();
        mapped={...mapped,part:{...value.part,text:this._text(binding,value.content_index,value.part.text)}};
      }else if(type==='response.content_part.added'&&binding.prior&&(value.part?.type!=='output_text'||value.part.text!==undefined&&value.part.text!==''||!emptyAnnotations(value.part)))throw invalid();
      return binding.prior?{...mapped,item_id:binding.id}:mapped;
    }
    return value;
  }
}
