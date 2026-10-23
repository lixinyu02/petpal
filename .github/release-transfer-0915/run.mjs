// Derived from the reviewed 0.9.12 byte transport. Only a freshly root-bound 0.9.15 draft executes.
// Metadata stays read-only; signing and metadata upload belong to the root operator.
import {createHash} from 'node:crypto';
import {downloadRanges,RangeDownloadError,summarizeFailure,mirrorIPv4Get} from './range-download.mjs';
import {createReadStream} from 'node:fs';
import {readFile,mkdir,open,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const PINNED = {"schemaVersion":1,"repository":"lixinyu02/petpal","tag":"v0.9.15","sourceRevision":"d8f0040925b951aabaa5de669db9a6abfe8116fe","contractHash":"3da7622338516d967963a8e4db647ccdba60dd8e291b2e272d74e0048dbf1709","branch":"release-transfer-v0.9.15","prerelease":false,"mode":"https-mirror","mirrorBaseUrl":"https://magicdatou.top:44318/downloads/updates/","releaseId":422273614,"stableLatest":"v0.9.14","stableLatestId":418674946,"sequence":17,"assets":[{"name":"PetPal-0.9.15-Windows-x64.exe","size":254060984,"sha256":"56098e28645ed1090eb5e5add2f2d50cd2ec952b7c243909eed3ca00ce4a679b"},{"name":"PetPal-0.9.15-Windows-x64.zip","size":416597818,"sha256":"d42ead39a152de3c6d0de48fceeaa02651757f1734f7285665914aab68e960f6"},{"name":"PetPal-0.9.15-Ubuntu-x64.tar.gz","size":384847254,"sha256":"d254acaf5b6c3accce9e9edc3c192d0e6b36da77575763e63755e6a3d66acff2"},{"name":"PetPal-0.9.15-Ubuntu-arm64.tar.gz","size":377126441,"sha256":"ba5eb219e7dad6724ac9df4a72a25a9fd5020b57ba0a751bf04a91b5b02cb914"},{"name":"PetPal-0.9.15-Android-debug.apk","size":149598203,"sha256":"ba7413ee8dfdd20361b662ad0064c6be9a36f03ad687f5fdbad61014719d5535"},{"name":"PetPal-0.9.15-Web.zip","size":51103537,"sha256":"0830fce84e8f48731afc5e5f0cdde5b43e5570d418f97cfe4b99aafe92dcea2a"},{"name":"release-manifest.json","size":2096,"sha256":"cc37701b6a6a31a304ab51e179e0e8b335eae4cb42c5dbbafed7b0f00588dc71"},{"name":"SHA256SUMS.txt","size":576,"sha256":"c798bc8a51ff44900332a32972d3acacbd32ab7fc3932966208ad43f659ad1f1"},{"name":"petpal-update.json","size":10726,"sha256":"263b55ab67b676f1de0a92c3faab65af6b8bd1e518592c2c4885a2e12b51321b"},{"name":"petpal-update-public-key.txt","size":113,"sha256":"7fd650afe5e5a7e1d35e0f2515e0ee7b604aa3dec7b8253593c485a3fa8febdb"}],"targets":["PetPal-0.9.15-Windows-x64.exe","PetPal-0.9.15-Windows-x64.zip","PetPal-0.9.15-Ubuntu-x64.tar.gz","PetPal-0.9.15-Ubuntu-arm64.tar.gz","PetPal-0.9.15-Android-debug.apk","PetPal-0.9.15-Web.zip","release-manifest.json","SHA256SUMS.txt","petpal-update.json","petpal-update-public-key.txt"],"completedAssets":[{"id":670292447,"name":"release-manifest.json","size":2096,"digest":"sha256:cc37701b6a6a31a304ab51e179e0e8b335eae4cb42c5dbbafed7b0f00588dc71"},{"id":670292453,"name":"SHA256SUMS.txt","size":576,"digest":"sha256:c798bc8a51ff44900332a32972d3acacbd32ab7fc3932966208ad43f659ad1f1"},{"id":670292448,"name":"petpal-update.json","size":10726,"digest":"sha256:263b55ab67b676f1de0a92c3faab65af6b8bd1e518592c2c4885a2e12b51321b"},{"id":670292449,"name":"petpal-update-public-key.txt","size":113,"digest":"sha256:7fd650afe5e5a7e1d35e0f2515e0ee7b604aa3dec7b8253593c485a3fa8febdb"}],"productionContext":{"backendVersion":"0.9.14","catalogVersion":"0.9.14","downloadVersions":{"android":"0.9.14","ubuntu":"0.9.14","windows":"0.9.14"},"updateSequence":16,"catalogPromoted":false},"reviewedTemplatesSha256":"8d399d28ac9a682d7b7cb5237e5005719ac3a86aafce82bfc26d6055c88a8097","localPlanHash":"c0a7146005f83e5bf84422c0f2be1f3527fd93e82045223037df212a466f0041","rootGate":{"schemaVersion":1,"version":"0.9.15","sourceRevision":"d8f0040925b951aabaa5de669db9a6abfe8116fe","contractHash":"3da7622338516d967963a8e4db647ccdba60dd8e291b2e272d74e0048dbf1709","planHash":"c0a7146005f83e5bf84422c0f2be1f3527fd93e82045223037df212a466f0041","releaseId":422273614,"sequence":17,"branch":"release-transfer-v0.9.15","action":"one cloud byte transfer for six packages and ten official body readbacks","authorizedBy":"/root","explicitAuthorization":true,"observedAt":"2026-10-23T20:25:20.012Z","localUploadersAbsent":true,"priorPackageUploadsAbsent":true,"unexpectedAssetsAbsent":true,"noAutomaticRetry":true,"sixMirrorPackagesReady":true,"metadataAlreadyUploadedAndFrozen":true,"draftOnly":true,"priorPackagePostCount":0,"cloudRunAttempt":1,"newCloudPerAssetPostLimit":1,"allowedPostNames":["PetPal-0.9.15-Windows-x64.exe","PetPal-0.9.15-Windows-x64.zip","PetPal-0.9.15-Ubuntu-x64.tar.gz","PetPal-0.9.15-Ubuntu-arm64.tar.gz","PetPal-0.9.15-Android-debug.apk","PetPal-0.9.15-Web.zip"],"completedAssets":[{"id":670292447,"name":"release-manifest.json","size":2096,"digest":"sha256:cc37701b6a6a31a304ab51e179e0e8b335eae4cb42c5dbbafed7b0f00588dc71"},{"id":670292453,"name":"SHA256SUMS.txt","size":576,"digest":"sha256:c798bc8a51ff44900332a32972d3acacbd32ab7fc3932966208ad43f659ad1f1"},{"id":670292448,"name":"petpal-update.json","size":10726,"digest":"sha256:263b55ab67b676f1de0a92c3faab65af6b8bd1e518592c2c4885a2e12b51321b"},{"id":670292449,"name":"petpal-update-public-key.txt","size":113,"digest":"sha256:7fd650afe5e5a7e1d35e0f2515e0ee7b604aa3dec7b8253593c485a3fa8febdb"}],"evidence":[{"path":".data/release-0.9.15/prepared/receipts/signed.json","sha256":"44aaa1e5d8481cf8b9d9f5c6c8c76fd26bbb0b3b8b4ee44ba48d1ca9e814f123"},{"path":".data/release-0.9.15/prepared/receipts/server-staged.json","sha256":"0037e4467f119861fb5c7b45a4ad13f1a21de5d98dae5791eee3240b3af4dca7"},{"path":".data/release-0.9.15/prepared/receipts/server-readback.json","sha256":"7d00c2f23eaede9c70cfba98380b777fc8298569c4de7ed96b70ddd0a03ffc04"},{"path":".data/release-0.9.15/prepared/receipts/server-extra-zip-readback.json","sha256":"eed086aef1b827b89f1395ab3fed2121281aec8dfa62c12daf931cf82ee0a99a"},{"path":".data/release-0.9.15/transfer-source/proofs/root-fresh-ready.json","sha256":"bc266c039b769ded4ec574bc8fb10ab66ab98a70e86cf70e4716a8431eeda20e"},{"path":".data/release-0.9.15/transfer-source/proofs/github-metadata-upload.json","sha256":"8d01c1cbabfc8ac881859465f2cbd8e00b3427ff6369a146547fba025a020ca1"}],"reviewedTemplatesSha256":"8d399d28ac9a682d7b7cb5237e5005719ac3a86aafce82bfc26d6055c88a8097","productionContext":{"backendVersion":"0.9.14","catalogVersion":"0.9.14","downloadVersions":{"android":"0.9.14","ubuntu":"0.9.14","windows":"0.9.14"},"updateSequence":16,"catalogPromoted":false}},"rootGateBytes":"eyJzY2hlbWFWZXJzaW9uIjoxLCJ2ZXJzaW9uIjoiMC45LjE1Iiwic291cmNlUmV2aXNpb24iOiJkOGYwMDQwOTI1Yjk1MWFhYmFhNWRlNjY5ZGI5YTZhYmZlODExNmZlIiwiY29udHJhY3RIYXNoIjoiM2RhNzYyMjMzODUxNmQ5Njc5NjNhOGU0ZGI2NDdjY2RiYTYwZGQ4ZTI5MWIyZTI3MmQ3NGUwMDQ4ZGJmMTcwOSIsInBsYW5IYXNoIjoiYzBhNzE0NjAwNWY4M2U1YmY4NDQyMmMwZjJiZTFmMzUyN2ZkOTNlODIwNDUyMjMwMzdkZjIxMmE0NjZmMDA0MSIsInJlbGVhc2VJZCI6NDIyMjczNjE0LCJzZXF1ZW5jZSI6MTcsImJyYW5jaCI6InJlbGVhc2UtdHJhbnNmZXItdjAuOS4xNSIsImFjdGlvbiI6Im9uZSBjbG91ZCBieXRlIHRyYW5zZmVyIGZvciBzaXggcGFja2FnZXMgYW5kIHRlbiBvZmZpY2lhbCBib2R5IHJlYWRiYWNrcyIsImF1dGhvcml6ZWRCeSI6Ii9yb290IiwiZXhwbGljaXRBdXRob3JpemF0aW9uIjp0cnVlLCJvYnNlcnZlZEF0IjoiMjAyNi0xMC0yM1QyMDoyNToyMC4wMTJaIiwibG9jYWxVcGxvYWRlcnNBYnNlbnQiOnRydWUsInByaW9yUGFja2FnZVVwbG9hZHNBYnNlbnQiOnRydWUsInVuZXhwZWN0ZWRBc3NldHNBYnNlbnQiOnRydWUsIm5vQXV0b21hdGljUmV0cnkiOnRydWUsInNpeE1pcnJvclBhY2thZ2VzUmVhZHkiOnRydWUsIm1ldGFkYXRhQWxyZWFkeVVwbG9hZGVkQW5kRnJvemVuIjp0cnVlLCJkcmFmdE9ubHkiOnRydWUsInByaW9yUGFja2FnZVBvc3RDb3VudCI6MCwiY2xvdWRSdW5BdHRlbXB0IjoxLCJuZXdDbG91ZFBlckFzc2V0UG9zdExpbWl0IjoxLCJhbGxvd2VkUG9zdE5hbWVzIjpbIlBldFBhbC0wLjkuMTUtV2luZG93cy14NjQuZXhlIiwiUGV0UGFsLTAuOS4xNS1XaW5kb3dzLXg2NC56aXAiLCJQZXRQYWwtMC45LjE1LVVidW50dS14NjQudGFyLmd6IiwiUGV0UGFsLTAuOS4xNS1VYnVudHUtYXJtNjQudGFyLmd6IiwiUGV0UGFsLTAuOS4xNS1BbmRyb2lkLWRlYnVnLmFwayIsIlBldFBhbC0wLjkuMTUtV2ViLnppcCJdLCJjb21wbGV0ZWRBc3NldHMiOlt7ImlkIjo2NzAyOTI0NDcsIm5hbWUiOiJyZWxlYXNlLW1hbmlmZXN0Lmpzb24iLCJzaXplIjoyMDk2LCJkaWdlc3QiOiJzaGEyNTY6Y2MzNzcwMWI2YTZhMzFhMzA0YWI1MWUxNzllMGU4YjMzNWVhZTRjYjQyYzVkYmJhZmVkN2IwZjAwNTg4ZGM3MSJ9LHsiaWQiOjY3MDI5MjQ1MywibmFtZSI6IlNIQTI1NlNVTVMudHh0Iiwic2l6ZSI6NTc2LCJkaWdlc3QiOiJzaGEyNTY6Yzc5OGJjOGE1MWZmNDQ5MDAzMzJhMzI5NzJkM2FjYWNiZDMyYWI3ZmMzOTMyOTY2MjA4YWQ0M2Y2NTlhZDFmMSJ9LHsiaWQiOjY3MDI5MjQ0OCwibmFtZSI6InBldHBhbC11cGRhdGUuanNvbiIsInNpemUiOjEwNzI2LCJkaWdlc3QiOiJzaGEyNTY6MjYzYjU1YWI2N2I2NzZmMWRlMGE5MmMzZmFhYjY1YWY2YjhiZDFlNTE4NTkyYzJjNDg4NWEyZTEyYjUxMzIxYiJ9LHsiaWQiOjY3MDI5MjQ0OSwibmFtZSI6InBldHBhbC11cGRhdGUtcHVibGljLWtleS50eHQiLCJzaXplIjoxMTMsImRpZ2VzdCI6InNoYTI1Njo3ZmQ2NTBhZmU1ZTVhN2UxZDM1ZTBmMjUxNWUwZWU3YjYwNGFhM2RlYzdiODI1MzU5M2M0ODVhM2ZhOGZlYmRiIn1dLCJldmlkZW5jZSI6W3sicGF0aCI6Ii5kYXRhL3JlbGVhc2UtMC45LjE1L3ByZXBhcmVkL3JlY2VpcHRzL3NpZ25lZC5qc29uIiwic2hhMjU2IjoiNDRhYWExZTVkODQ4MWNmOGI5ZDlmNWM2YzhjNzZmZDI2YmJiMGIzYjhiNGVlNDRiYTQ4ZDFjYTllODE0ZjEyMyJ9LHsicGF0aCI6Ii5kYXRhL3JlbGVhc2UtMC45LjE1L3ByZXBhcmVkL3JlY2VpcHRzL3NlcnZlci1zdGFnZWQuanNvbiIsInNoYTI1NiI6IjAwMzdlNDQ2N2YxMTk4NjFmYjVjN2I0NWE0YWQxM2YxYTIxZGU1ZDk4ZGFlNTc5MWVlZTMyNDBiM2FmNGRjYTcifSx7InBhdGgiOiIuZGF0YS9yZWxlYXNlLTAuOS4xNS9wcmVwYXJlZC9yZWNlaXB0cy9zZXJ2ZXItcmVhZGJhY2suanNvbiIsInNoYTI1NiI6IjdkMDBjMmYyM2VhZWRlOWM3MGNmYmE5ODM4MGI3NzdmYzgyOTg1NjljNGRlN2VkOTZiNzBkZGQwYTAzZmZjMDQifSx7InBhdGgiOiIuZGF0YS9yZWxlYXNlLTAuOS4xNS9wcmVwYXJlZC9yZWNlaXB0cy9zZXJ2ZXItZXh0cmEtemlwLXJlYWRiYWNrLmpzb24iLCJzaGEyNTYiOiJlZWQwODZhZWYxYjgyN2I4OWYxMzk1YWIzZmVkMjEyMTI4MWFlYzhkZmE2MmMxMmRhZjkzMWNmODJlZTBhOTlhIn0seyJwYXRoIjoiLmRhdGEvcmVsZWFzZS0wLjkuMTUvdHJhbnNmZXItc291cmNlL3Byb29mcy9yb290LWZyZXNoLXJlYWR5Lmpzb24iLCJzaGEyNTYiOiJiYzI2NmMwMzliNzY5ZGVkNGVjNTc0YmM4ZmIxMGFiNjZhYjk4YTcwZTg2Y2Y3MGU0NzE2YTg0MzFlZWRhMjBlIn0seyJwYXRoIjoiLmRhdGEvcmVsZWFzZS0wLjkuMTUvdHJhbnNmZXItc291cmNlL3Byb29mcy9naXRodWItbWV0YWRhdGEtdXBsb2FkLmpzb24iLCJzaGEyNTYiOiI4ZDAxYzFjYmFiZmM4YWM4ODE4NTk0NjVmMmNiZDhlMDBiMzQyN2ZmNjM2OWExNDY1NDdmYmEwMjVhMDIwY2ExIn1dLCJyZXZpZXdlZFRlbXBsYXRlc1NoYTI1NiI6IjhkMzk5ZDI4YWM5YTY4MmQ3YjdjYjUyMzdlNTAwNTcxOWFjM2E4NmFhZmNlODJiZmMyNmQ2MDU1Yzg4YTgwOTciLCJwcm9kdWN0aW9uQ29udGV4dCI6eyJiYWNrZW5kVmVyc2lvbiI6IjAuOS4xNCIsImNhdGFsb2dWZXJzaW9uIjoiMC45LjE0IiwiZG93bmxvYWRWZXJzaW9ucyI6eyJhbmRyb2lkIjoiMC45LjE0IiwidWJ1bnR1IjoiMC45LjE0Iiwid2luZG93cyI6IjAuOS4xNCJ9LCJ1cGRhdGVTZXF1ZW5jZSI6MTYsImNhdGFsb2dQcm9tb3RlZCI6ZmFsc2V9fQ==","rootGateSha256":"86e6eefee3494e8de44d1e85fdcb0149f7598f4ad6c434e991cb15a5f9c8e4e1"};
export const REPOSITORY='lixinyu02/petpal',TAG='v0.9.15',SOURCE='d8f0040925b951aabaa5de669db9a6abfe8116fe',BRANCH='release-transfer-v0.9.15',DRAFT_RELEASE_ID=422273614;
export const PACKAGE_NAMES=['PetPal-0.9.15-Windows-x64.exe','PetPal-0.9.15-Windows-x64.zip','PetPal-0.9.15-Ubuntu-x64.tar.gz','PetPal-0.9.15-Ubuntu-arm64.tar.gz','PetPal-0.9.15-Android-debug.apk','PetPal-0.9.15-Web.zip'];
export const METADATA_NAMES=['release-manifest.json','SHA256SUMS.txt','petpal-update.json','petpal-update-public-key.txt'];
export const CONTRACT_HASH='3da7622338516d967963a8e4db647ccdba60dd8e291b2e272d74e0048dbf1709',PLAN_HASH='c0a7146005f83e5bf84422c0f2be1f3527fd93e82045223037df212a466f0041';
const API='https://api.github.com/repos/'+REPOSITORY;
class TransferError extends Error {}
const need=(value,code)=>{if(!value)throw new TransferError(code);};
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const exact=(asset,target)=>asset?.name===target.name&&asset.state==='uploaded'&&asset.size===target.size&&asset.digest==='sha256:'+target.sha256;
export function validatePlan(plan){
 const {localPlanHash,rootGate,rootGateBytes,rootGateSha256,...core}=plan||{};
 need(sha256(Buffer.from(JSON.stringify(core)))===PLAN_HASH,'frozen-plan-bytes-mismatch');
 need(plan?.schemaVersion===1&&plan.repository===REPOSITORY&&plan.tag===TAG&&plan.sourceRevision===SOURCE&&plan.branch===BRANCH&&plan.prerelease===false&&plan.mode==='https-mirror'&&plan.releaseId===DRAFT_RELEASE_ID&&plan.stableLatest==='v0.9.14'&&plan.stableLatestId===418674946&&plan.sequence===17,'frozen-plan-identity-mismatch');
 need(plan.contractHash===CONTRACT_HASH&&plan.localPlanHash===PLAN_HASH,'contract-or-plan-hash-mismatch');
 need(Array.isArray(plan.assets)&&plan.assets.length===10&&JSON.stringify(plan.targets)===JSON.stringify([...PACKAGE_NAMES,...METADATA_NAMES]),'frozen-asset-set-mismatch');
 const seen=new Set();for(const asset of plan.assets){need(plan.targets.includes(asset.name)&&!seen.has(asset.name)&&Number.isSafeInteger(asset.size)&&asset.size>0&&asset.size<=2*1024**3&&/^[a-f0-9]{64}$/.test(asset.sha256),'frozen-asset-invalid');seen.add(asset.name);}
 need(!Object.hasOwn(plan,'inlineMetadata'),'inline-metadata-forbidden');
 need(plan.mirrorBaseUrl==='https://magicdatou.top:44318/downloads/updates/','mirror-base-invalid');
 need(plan.completedAssets?.length===4&&JSON.stringify(plan.completedAssets.map(a=>a.name))===JSON.stringify(METADATA_NAMES)&&new Set(plan.completedAssets.map(a=>a.id)).size===4,'completed-set-invalid');
 for(const row of plan.completedAssets){const target=plan.assets.find(a=>a.name===row.name);need(Number.isSafeInteger(row.id)&&row.id>0&&row.size===target.size&&row.digest==='sha256:'+target.sha256,'completed-identity-invalid');}
 need(plan.rootGate?.authorizedBy==='/root'&&plan.rootGate.explicitAuthorization===true&&plan.rootGate.localUploadersAbsent===true&&plan.rootGate.priorPackageUploadsAbsent===true&&plan.rootGate.unexpectedAssetsAbsent===true&&plan.rootGate.noAutomaticRetry===true&&plan.rootGate.sixMirrorPackagesReady===true&&plan.rootGate.metadataAlreadyUploadedAndFrozen===true&&plan.rootGate.draftOnly===true&&plan.rootGate.reviewedTemplatesSha256===plan.reviewedTemplatesSha256&&/^[a-f0-9]{64}$/.test(plan.rootGateSha256||'')&&sha256(Buffer.from(plan.rootGateBytes,'base64'))===plan.rootGateSha256,'root-gate-invalid');
 need(JSON.stringify(JSON.parse(Buffer.from(plan.rootGateBytes,'base64')) )===JSON.stringify(plan.rootGate),'root-gate-bytes-mismatch');
 need(JSON.stringify(plan.productionContext)===JSON.stringify({"backendVersion":"0.9.14","catalogVersion":"0.9.14","downloadVersions":{"android":"0.9.14","ubuntu":"0.9.14","windows":"0.9.14"},"updateSequence":16,"catalogPromoted":false})&&JSON.stringify(plan.rootGate.productionContext)===JSON.stringify(plan.productionContext),'production-context-mismatch');
 need(/^[a-f0-9]{64}$/.test(plan.reviewedTemplatesSha256||''),'reviewed-templates-hash-invalid');
 for(const[key,value]of Object.entries({schemaVersion:1,version:'0.9.15',sourceRevision:SOURCE,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,releaseId:DRAFT_RELEASE_ID,sequence:17,branch:BRANCH,action:'one cloud byte transfer for six packages and ten official body readbacks',priorPackagePostCount:0,cloudRunAttempt:1,newCloudPerAssetPostLimit:1}))need(plan.rootGate[key]===value,'root-gate-identity-mismatch');
 need(JSON.stringify(plan.rootGate.allowedPostNames)===JSON.stringify(PACKAGE_NAMES)&&JSON.stringify(plan.rootGate.completedAssets)===JSON.stringify(plan.completedAssets),'root-gate-asset-scope-mismatch');
 need(Array.isArray(plan.rootGate.evidence)&&plan.rootGate.evidence.length>=5&&new Set(plan.rootGate.evidence.map(e=>e.path)).size===plan.rootGate.evidence.length,'root-evidence-set-invalid');
 for(const row of plan.rootGate.evidence){need(typeof row.path==='string'&&(row.path.startsWith('.data/release-0.9.15/prepared/receipts/')||row.path.startsWith('.data/release-0.9.15/transfer-source/proofs/'))&&!row.path.includes('..')&&/^[a-f0-9]{64}$/.test(row.sha256),'root-evidence-invalid');}
 return plan;
}
export function validateScope(env,{version=process.version,platform=process.platform}={}){
 need(env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','tls-verification-disabled');
 need(version==='v24.19.0'&&platform==='linux'&&env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF==='refs/heads/'+BRANCH&&env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_RUN_ATTEMPT==='1'&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID||''),'runner-scope-mismatch');
}
export function cdnRedirect(value,visited=new Set()){
 let url;try{url=new URL(value);}catch{throw new TransferError('redirect-rejected');}
 need(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.hash&&url.hostname==='release-assets.githubusercontent.com'&&url.pathname.startsWith('/github-production-release-asset/')&&!visited.has(url.href),'redirect-rejected');
 visited.add(url.href);return url;
}

export function createClient(plan,{token,fetchImpl=fetch,log=()=>{},now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),deadline=Date.now()+235*60000,settleCount=12}={}){
 validatePlan(plan);need(typeof token==='string'&&token.length>=20&&!/[\s\x00-\x1f\x7f]/.test(token),'runner-token-missing');
 const signal=budget=>{const remaining=deadline-now();need(remaining>0,'transfer-deadline');return AbortSignal.timeout(Math.max(1,Math.min(remaining,budget)));};
 const auth=()=>({Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'PetPal-Fixed-Release-Transfer'});
 const uploadAttemptedNames=[];let apiRequest=0;
 const freshApiUrl=endpoint=>API+endpoint+(endpoint.includes('?')?'&':'?')+'petpal_gate='+now()+'-'+(++apiRequest);
 const freshHeaders=()=>({...auth(),'Cache-Control':'no-cache','Pragma':'no-cache'});
 const readJson=async response=>{need(response.status===200&&response.body,'api-read-failed');const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;need(size<=2*1024*1024,'api-response-too-large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks));};
 const api=async endpoint=>{
  need(endpoint===`/releases/${plan.releaseId}`||endpoint==='/releases/latest'||endpoint===`/releases/${plan.releaseId}/assets?per_page=100`||/^\/releases\/assets\/[1-9][0-9]*$/.test(endpoint)||endpoint===`/git/matching-refs/tags/${TAG}`||/^\/git\/tags\/[a-f0-9]{40}$/.test(endpoint)||endpoint==='/git/ref/heads/main','api-path-rejected');
  return readJson(await fetchImpl(freshApiUrl(endpoint),{headers:freshHeaders(),redirect:'error',signal:signal(60000)}));
 };
 const verifyTag=async()=>{
  const refs=await api(`/git/matching-refs/tags/${TAG}`);need(Array.isArray(refs)&&refs.length<100,'tag-list-invalid');
  const found=refs.filter(ref=>ref.ref===`refs/tags/${TAG}`);need(found.length===1,'source-tag-missing-or-duplicate');
  let object=found[0].object;const visited=new Set();
  for(let depth=0;depth<=5;depth++){need(object&&/^[a-f0-9]{40}$/.test(object.sha)&&!visited.has(object.sha),'tag-object-invalid');visited.add(object.sha);if(object.type==='commit'){need(object.sha===SOURCE,'source-tag-mismatch');return;}need(object.type==='tag','tag-object-invalid');object=(await api(`/git/tags/${object.sha}`)).object;}
  throw new TransferError('tag-depth-exceeded');
 };
 const checkDraft=async()=>{
  await verifyTag();const release=await api(`/releases/${plan.releaseId}`),latest=await api('/releases/latest');
  need(release.id===plan.releaseId&&release.draft===true&&release.prerelease===false&&release.tag_name===TAG&&[SOURCE,'main'].includes(release.target_commitish)&&release.url===`${API}/releases/${plan.releaseId}`,'draft-identity-changed');
  if(release.target_commitish==='main'){const ref=await api('/git/ref/heads/main');need(ref.ref==='refs/heads/main'&&ref.object?.type==='commit'&&ref.object.sha===SOURCE,'source-main-mismatch');}
  need(latest.id===plan.stableLatestId&&latest.tag_name===plan.stableLatest&&latest.draft===false&&latest.prerelease===false,'stable-latest-changed');
 };
 const assets=async()=>{
  const values=await api(`/releases/${plan.releaseId}/assets?per_page=100`);need(Array.isArray(values)&&values.length<100,'asset-list-invalid');const names=new Set();
  for(const asset of values){need(plan.assets.some(spec=>spec.name===asset.name)&&!names.has(asset.name),'unexpected-or-duplicate-asset');names.add(asset.name);}
  return values;
 };
 const currentTarget=async target=>{await checkDraft();return(await assets()).find(asset=>asset.name===target.name);};
 const saveBody=async(response,target,file,stage)=>{
  need(response.status===200&&response.body,'download-failed');need(!response.headers.get('content-encoding')||response.headers.get('content-encoding')==='identity','download-encoding-rejected');
  const length=response.headers.get('content-length');need(length===null||(/^[0-9]+$/.test(length)&&Number(length)===target.size),'download-length-mismatch');
  const output=await open(file,'wx',0o600),hash=createHash('sha256');let size=0,last=now();
  try{for await(const chunk of response.body){size+=chunk.length;need(size<=target.size,'download-size-overrun');hash.update(chunk);await output.writeFile(chunk);if(now()-last>=60000){log('download-progress',{name:target.name,bytes:size,total:target.size});last=now();}}await output.sync();}finally{await output.close();}
  need(size===target.size&&hash.digest('hex')===target.sha256,'download-bytes-mismatch');const diskHash=createHash('sha256');for await(const chunk of createReadStream(file))diskHash.update(chunk);
  need((await stat(file)).size===target.size&&diskHash.digest('hex')===target.sha256,'local-file-bytes-mismatch');need(now()<deadline,'transfer-deadline');
  log(stage,{name:target.name,bytes:size,sha256:target.sha256,installerExecuted:false});return file;
 };
 const mirror=async(target,directory)=>{
  need(PACKAGE_NAMES.includes(target.name),'mirror-target-rejected');const mirrorFetch=fetchImpl===fetch?mirrorIPv4Get:fetchImpl;
  return(await downloadRanges(target,directory,{fetchImpl:mirrorFetch,connections:8,deadline:Math.min(deadline,now()+32*60000),now,log})).file;
 };
 const frozenTarget=target=>plan.assets.some(row=>row.name===target?.name&&row.size===target.size&&row.sha256===target.sha256);
 const readback=async(asset,target,directory)=>{
  need(frozenTarget(target),'readback-target-not-frozen');
  need(Number.isSafeInteger(asset.id)&&asset.id>0&&exact(await api(`/releases/assets/${asset.id}`),target),'source-metadata-mismatch');
  const readbackSignal=signal(10*60000),visited=new Set();let response=await fetchImpl(freshApiUrl(`/releases/assets/${asset.id}`),{headers:{...freshHeaders(),Accept:'application/octet-stream','Accept-Encoding':'identity'},redirect:'manual',signal:readbackSignal});
  for(let hop=0;[301,302,303,307,308].includes(response.status);hop++){
   need(hop<4,'redirect-limit');const url=cdnRedirect(response.headers.get('location'),visited);await response.body?.cancel();
   // CDN receives no Authorization header, even for subsequent redirects.
   response=await fetchImpl(url,{headers:{Accept:'application/octet-stream','Accept-Encoding':'identity'},redirect:'manual',signal:readbackSignal});
  }
  await saveBody(response,target,path.join(directory,`github-${asset.id}-${target.name}`),'github-bytes-verified');const final=await currentTarget(target);
  need(exact(final,target)&&final.id===asset.id,'readback-target-changed');log('final-asset-verified',{id:asset.id,name:target.name,size:target.size,sha256:target.sha256,draft:true,published:false,installerExecuted:false});
  return final;
 };
 const settle=async target=>{
  for(let attempt=0;attempt<settleCount;attempt++){
   const asset=await currentTarget(target);if(asset?.state==='uploaded'){need(exact(asset,target),'uploaded-target-mismatch');return asset;}
   if(attempt+1<settleCount){need(now()+15000<deadline,'transfer-deadline');await pause(15000);}
  }throw new TransferError('upload-unverified-no-retry');
 };
 const readCompleted=async(target,directory)=>{
  need(frozenTarget(target)&&METADATA_NAMES.includes(target.name),'metadata-read-scope-rejected');
  const existing=await currentTarget(target),completed=plan.completedAssets.find(row=>row.name===target.name);
  need(completed&&exact(existing,target)&&existing.id===completed.id,'completed-target-changed');log('existing-upload-reused',{name:target.name,id:existing.id});return readback(existing,target,directory);
 };
 const uploadOrReuse=async(file,target,directory)=>{
  need(frozenTarget(target)&&PACKAGE_NAMES.includes(target.name)&&plan.rootGate.allowedPostNames.includes(target.name),'package-upload-scope-rejected');
  const existing=await currentTarget(target),completed=plan.completedAssets.find(row=>row.name===target.name);
  if(completed){need(exact(existing,target)&&existing.id===completed.id,'completed-target-changed');log('existing-upload-reused',{name:target.name,id:existing.id});return readback(existing,target,directory);}
  need(!existing,'unexpected-prior-target-no-post');
  const reservation={name:target.name,bytes:target.size,sha256:target.sha256,releaseId:plan.releaseId,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,uploadInvocations:1,noAutomaticRetry:true,rootGateSha256:plan.rootGateSha256};
  const journal=await open(path.join(directory,'upload-attempt.json'),'wx',0o600);try{await journal.writeFile(JSON.stringify(reservation));await journal.sync();}finally{await journal.close();}
  need(!await currentTarget(target),'target-created-before-upload');log('upload-attempt-reserved',reservation);uploadAttemptedNames.push(target.name);
  try{const response=await fetchImpl('https://uploads.github.com/repos/'+REPOSITORY+'/releases/'+plan.releaseId+'/assets?name='+encodeURIComponent(target.name),{method:'POST',headers:{...auth(),'Content-Type':'application/octet-stream','Content-Length':String(target.size)},body:createReadStream(file),duplex:'half',redirect:'error',signal:signal(10*60000)});log('upload-response',{name:target.name,httpStatus:response.status});await response.body?.cancel();}
  catch(error){log('upload-result-uncertain',{name:target.name,...summarizeFailure(error)});}
  return readback(await settle(target),target,directory);
 };
 
 return{api,checkDraft,assets,currentTarget,mirror,readback,readCompleted,uploadOrReuse,settle,uploadAttemptedNames};
}

export async function transfer(plan,{env=process.env,fetchImpl=fetch,log=(stage,details={})=>console.log(JSON.stringify({stage,...details})),runtime,pause}={}){
 validatePlan(plan);validateScope(env,runtime);need(path.isAbsolute(env.RUNNER_TEMP||''),'runner-directory-invalid');
 need(Number.isFinite(Date.parse(plan.rootGate.observedAt))&&Date.parse(plan.rootGate.observedAt)<=Date.now()+5000&&Date.now()-Date.parse(plan.rootGate.observedAt)<=30*60000,'root-gate-expired');
 const token=env.GH_TOKEN;delete env.GH_TOKEN;const client=createClient(plan,{token,fetchImpl,log,pause});
 const work=path.join(env.RUNNER_TEMP,'petpal-0915-cloud-'+env.GITHUB_RUN_ID);await mkdir(work,{mode:0o700});
 log('runner-scope-verified',{repository:REPOSITORY,tag:TAG,sourceRevision:SOURCE,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,releaseId:plan.releaseId,headSha:env.GITHUB_SHA,branch:BRANCH,runId:Number(env.GITHUB_RUN_ID),runAttempt:1,rootGateSha256:plan.rootGateSha256});
 await client.checkDraft();const initial=await client.assets();need(initial.length===4&&plan.completedAssets.every(a=>{const r=initial.find(r=>r.name===a.name),t=plan.assets.find(t=>t.name===a.name);return exact(r,t)&&r.id===a.id;}),'initial-set-not-clean');
 const verified=[];
 for(const [position,name]of plan.targets.entries()){
  const target=plan.assets.find(a=>a.name===name),directory=path.join(work,'target-'+position);await mkdir(directory,{mode:0o700});
  const asset=PACKAGE_NAMES.includes(name)?await client.uploadOrReuse(await client.mirror(target,directory),target,directory):await client.readCompleted(target,directory);verified.push({id:asset.id,...target});
 }
 await client.checkDraft();const final=await client.assets();need(final.length===10&&plan.assets.every(t=>exact(final.find(a=>a.name===t.name),t))&&verified.every(v=>final.find(a=>a.name===v.name)?.id===v.id)&&plan.completedAssets.every(v=>final.find(a=>a.name===v.name)?.id===v.id),'complete-asset-set-mismatch');
 log('all-targets-verified',{targets:verified,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,rootGateSha256:plan.rootGateSha256,draft:true,published:false,installerExecuted:false,metadataHandledByThisRunner:false,metadataReadOnly:true,uploadAttemptedNames:client.uploadAttemptedNames});return verified;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{need(PINNED,'frozen-plan-not-generated');const recipe=JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'plan.json'),'utf8'));need(JSON.stringify(recipe)===JSON.stringify(PINNED),'runner-recipe-bytes-mismatch');await transfer(PINNED);}
 catch(error){console.error(JSON.stringify({stage:'failed',code:error instanceof TransferError?error.message:error instanceof RangeDownloadError?summarizeFailure(error).rangeCode:'unexpected-error',...summarizeFailure(error),installerExecuted:false,published:false}));process.exitCode=1;}
}
