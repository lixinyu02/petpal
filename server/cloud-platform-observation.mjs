/** Pod Running alone does not prove the platform's PID/network readiness checks. */
export function platformObservation(reply,record){
 const phase=reply.phase;
 const ready=phase==='running'&&!['stopped','exited','unknown'].includes(reply.dockerState);
 const state=ready?'running':phase==='creating'?'creating':phase==='stopped'||reply.dockerState==='stopped'||reply.dockerState==='exited'?'stopped':'unknown';
 return{revision:reply.revision,state,generation:JSON.stringify([reply.revision,reply.generation??'',reply.containerId??'',reply.observation?.startedAt??'']),desktop:ready&&record.bundle==='desktop'&&String(reply.desktopProtocol??'1')==='1',arch:'x64'};
}
