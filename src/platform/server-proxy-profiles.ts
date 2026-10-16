import {api} from '../api';

export type ServerProxyProfile={id:string;name:string;revision:string;sha256:string;updatedAt:string;mode:'rule'|'global'|'direct';selections:Record<string,string>;groups:Array<{name:string;choices:string[];dynamic?:true}>};
export type ServerProxyAdminProfile=ServerProxyProfile&{userIds:string[]};
export type ServerProxyProfileInput={name:string;yaml:string;mode?:ServerProxyProfile['mode'];selections?:Record<string,string>;userIds?:string[]};
export type ServerProxyProfilePatch=Partial<ServerProxyProfileInput>&{revision:string};
const id=(value:string)=>{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))throw new Error('服务器代理配置标识无效。');return value;};
export async function listServerProxyProfiles(signal?:AbortSignal){return api<{profiles:ServerProxyProfile[]}>('/app-proxy/profiles',{signal});}
export async function getServerProxyProfile(profileId:string,signal?:AbortSignal){return api<{profile:ServerProxyProfile}>(`/app-proxy/profiles/${id(profileId)}`,{signal});}
export async function listAdminProxyProfiles(signal?:AbortSignal){return api<{profiles:ServerProxyAdminProfile[]}>('/app-proxy/admin/profiles',{signal});}
export async function createServerProxyProfile(input:ServerProxyProfileInput){return api<{profile:ServerProxyAdminProfile}>('/app-proxy/profiles',{method:'POST',body:JSON.stringify(input)});}
export async function updateServerProxyProfile(profileId:string,input:ServerProxyProfilePatch){const payload={...input};if(!payload.yaml)delete payload.yaml;return api<{profile:ServerProxyAdminProfile}>(`/app-proxy/profiles/${id(profileId)}`,{method:'PUT',body:JSON.stringify(payload)});}
export async function deleteServerProxyProfile(profileId:string,revision:string){return api<{ok:true}>(`/app-proxy/profiles/${id(profileId)}`,{method:'DELETE',body:JSON.stringify({revision})});}
