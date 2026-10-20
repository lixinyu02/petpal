// Derived from the reviewed 0.9.12 byte transport. Only this pinned 0.9.14 draft executes.
// Metadata stays read-only; signing and metadata upload belong to the root operator.
import {createHash} from 'node:crypto';
import {downloadRanges,RangeDownloadError,summarizeFailure,mirrorIPv4Get} from './range-download.mjs';
import {createReadStream} from 'node:fs';
import {readFile,mkdir,open,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const PINNED = {"schemaVersion":1,"repository":"lixinyu02/petpal","tag":"v0.9.14","sourceRevision":"7b8f84f5b3962efaebbacb3d5af72cecdc790e59","contractHash":"62a0d6e5dc2f4e57bff58f02523c0443870ba88911aa74c9f83d02dd66b0cbeb","branch":"release-transfer-v0.9.14","prerelease":false,"mode":"https-mirror","mirrorBaseUrl":"https://magicdatou.top:44318/downloads/updates/","releaseId":418674946,"stableLatest":"v0.9.13","stableLatestId":414528577,"sequence":16,"assets":[{"name":"PetPal-0.9.14-Windows-x64.exe","size":252965926,"sha256":"bb70f737867e6f3d3b37e2f765046e77aa4a137f432aefacffa8ffc146669f4b"},{"name":"PetPal-0.9.14-Windows-x64.zip","size":409686158,"sha256":"4cc3e8d624ea32f5b88657608ffe96cd4e9387f59df4aaf646356ed39ccb9f78"},{"name":"PetPal-0.9.14-Ubuntu-x64.tar.gz","size":381537255,"sha256":"66f3ef9dc689db8aa8d4b88cac722809f6c91ed16852704fa951b524d9d2cc98"},{"name":"PetPal-0.9.14-Ubuntu-arm64.tar.gz","size":373812483,"sha256":"45ec0896ad95d64f8b8ee539ca88f2536a8bb4222c78ec87d803df4f34f3956b"},{"name":"PetPal-0.9.14-Android-debug.apk","size":149465965,"sha256":"8f8e69fa3c5c4364a202df60cce74ce030d4019610bf5476b4eb2a9b65c18fc9"},{"name":"PetPal-0.9.14-Web.zip","size":51007139,"sha256":"cca0aee0495b0249a207ddbae679fd1c36c362658de6106ab5d7185d45f507af"},{"name":"release-manifest.json","size":2048,"sha256":"8c2ad0131ec0c2f4dde9dbc79b0018a9f37fb1da8868c06bb7a9a6059b33d9cd"},{"name":"SHA256SUMS.txt","size":576,"sha256":"b95000c52a350301c6233c72fc35cdf088055f2be78da6815332f31ebd6a9970"},{"name":"petpal-update.json","size":10273,"sha256":"070339c74f43b6fcc7013dc386c733f17fe22be8ca87102173aa0209b0103ff4"},{"name":"petpal-update-public-key.txt","size":113,"sha256":"7fd650afe5e5a7e1d35e0f2515e0ee7b604aa3dec7b8253593c485a3fa8febdb"}],"targets":["PetPal-0.9.14-Windows-x64.exe","PetPal-0.9.14-Windows-x64.zip","PetPal-0.9.14-Ubuntu-x64.tar.gz","PetPal-0.9.14-Ubuntu-arm64.tar.gz","PetPal-0.9.14-Android-debug.apk","PetPal-0.9.14-Web.zip","release-manifest.json","SHA256SUMS.txt","petpal-update.json","petpal-update-public-key.txt"],"completedAssets":[{"id":660020842,"name":"release-manifest.json","size":2048,"digest":"sha256:8c2ad0131ec0c2f4dde9dbc79b0018a9f37fb1da8868c06bb7a9a6059b33d9cd"},{"id":660020843,"name":"SHA256SUMS.txt","size":576,"digest":"sha256:b95000c52a350301c6233c72fc35cdf088055f2be78da6815332f31ebd6a9970"},{"id":660020844,"name":"petpal-update.json","size":10273,"digest":"sha256:070339c74f43b6fcc7013dc386c733f17fe22be8ca87102173aa0209b0103ff4"},{"id":660020846,"name":"petpal-update-public-key.txt","size":113,"digest":"sha256:7fd650afe5e5a7e1d35e0f2515e0ee7b604aa3dec7b8253593c485a3fa8febdb"}],"productionContext":{"backendVersion":"0.9.14","catalogVersion":"mixed-legacy","downloadVersions":{"android":"0.9.13","web":"0.9.13","windows":"0.9.12","ubuntu":"0.9.12"},"updateSequence":15,"catalogPromoted":false},"reviewedTemplatesSha256":"41695182fc3b9a0dab09e5265e026fb59283d1df44da4d4b08cdaf6f928f8a9b","localPlanHash":"03ab80582827483fcc805d858366eae4ce965896a47efaf0ea1f4f1541dac7ba","rootGate":{"schemaVersion":1,"version":"0.9.14","sourceRevision":"7b8f84f5b3962efaebbacb3d5af72cecdc790e59","contractHash":"62a0d6e5dc2f4e57bff58f02523c0443870ba88911aa74c9f83d02dd66b0cbeb","planHash":"03ab80582827483fcc805d858366eae4ce965896a47efaf0ea1f4f1541dac7ba","releaseId":418674946,"sequence":16,"branch":"release-transfer-v0.9.14","action":"one cloud byte transfer for six packages and ten official body readbacks","authorizedBy":"/root","explicitAuthorization":true,"observedAt":"2026-10-20T17:49:55.087Z","localUploadersAbsent":true,"originalUploadAttemptsPreserved":true,"startersRemoved":true,"noAutomaticRetry":true,"sixMirrorPackagesReady":true,"metadataAlreadyUploadedAndFrozen":true,"draftOnly":true,"originalGhHttpPostCount":"unknown","cloudRunAttempt":1,"newCloudPerAssetPostLimit":1,"allowedPostNames":["PetPal-0.9.14-Windows-x64.exe","PetPal-0.9.14-Windows-x64.zip","PetPal-0.9.14-Ubuntu-x64.tar.gz","PetPal-0.9.14-Ubuntu-arm64.tar.gz","PetPal-0.9.14-Android-debug.apk","PetPal-0.9.14-Web.zip"],"completedAssets":[{"id":660020842,"name":"release-manifest.json","size":2048,"digest":"sha256:8c2ad0131ec0c2f4dde9dbc79b0018a9f37fb1da8868c06bb7a9a6059b33d9cd"},{"id":660020843,"name":"SHA256SUMS.txt","size":576,"digest":"sha256:b95000c52a350301c6233c72fc35cdf088055f2be78da6815332f31ebd6a9970"},{"id":660020844,"name":"petpal-update.json","size":10273,"digest":"sha256:070339c74f43b6fcc7013dc386c733f17fe22be8ca87102173aa0209b0103ff4"},{"id":660020846,"name":"petpal-update-public-key.txt","size":113,"digest":"sha256:7fd650afe5e5a7e1d35e0f2515e0ee7b604aa3dec7b8253593c485a3fa8febdb"}],"evidence":[{"path":".data/release-0.9.14/transfer-source/proofs/github-owned-upload-stop.json","sha256":"ae60fe6a7b28afd5f841543ffcc03d23eef070980b58ba61a89a2bb4c475ddb0"},{"path":".data/release-0.9.14/transfer-source/proofs/github-owned-web-upload-stop.json","sha256":"38abc528d40fc01352474f86e3b41c4b18552c9c68ef556eaef51b0740597dca"},{"path":".data/release-0.9.14/transfer-source/proofs/github-starter-cleanup.json","sha256":"af2dca3cccaf38313234de80fb76e57250db52ea1601d8a68cbae0967a8c09be"},{"path":".data/release-0.9.14/transfer-source/proofs/github-metadata-upload.json","sha256":"aea1e6daebaf0d7a6bed3be99ecdf124d4ebe422f529b3d72d7e11ae1027fefb"},{"path":".data/release-0.9.14/transfer-source/proofs/github-tunnel-cleanup.json","sha256":"582595d178f594d8e0186d038029b3336169f04c6d19cef06ce219c18f089fd0"},{"path":".data/release-0.9.14/transfer-source/proofs/fresh-production.json","sha256":"b28691fdbaa3f3cc2ab8ec3ac88fd9d45f306a7c518bd2becdd734059ea6cdb5"},{"path":".data/release-0.9.14/transfer-source/proofs/local-uploaders.json","sha256":"54f70e9809c35ef47baa54df07c113bb5fe9835506fd9aad327f3a1819f611ee"},{"path":".data/release-0.9.14/prepared/receipts/server-readback.json","sha256":"857aab3d5242a756ec473e31282a18f063db22e55f45ec86dec6437736f3c284"},{"path":".data/release-0.9.14/prepared/receipts/server-extra-zip-readback.json","sha256":"01fe310584786fd1fee088e3329bc132264cf0b26d8b5198845ac055c970ec07"},{"path":".data/release-0.9.14/prepared/receipts/signed.json","sha256":"6ce2400e6be25cb6e7b382334f005549ebced4167a1c4504d6a32fe9dc6c59a2"}],"reviewedTemplatesSha256":"41695182fc3b9a0dab09e5265e026fb59283d1df44da4d4b08cdaf6f928f8a9b","productionContext":{"backendVersion":"0.9.14","catalogVersion":"mixed-legacy","downloadVersions":{"android":"0.9.13","web":"0.9.13","windows":"0.9.12","ubuntu":"0.9.12"},"updateSequence":15,"catalogPromoted":false}},"rootGateBytes":"eyJzY2hlbWFWZXJzaW9uIjoxLCJ2ZXJzaW9uIjoiMC45LjE0Iiwic291cmNlUmV2aXNpb24iOiI3YjhmODRmNWIzOTYyZWZhZWJiYWNiM2Q1YWY3MmNlY2RjNzkwZTU5IiwiY29udHJhY3RIYXNoIjoiNjJhMGQ2ZTVkYzJmNGU1N2JmZjU4ZjAyNTIzYzA0NDM4NzBiYTg4OTExYWE3NGM5ZjgzZDAyZGQ2NmIwY2JlYiIsInBsYW5IYXNoIjoiMDNhYjgwNTgyODI3NDgzZmNjODA1ZDg1ODM2NmVhZTRjZTk2NTg5NmE0N2VmYWYwZWExZjRmMTU0MWRhYzdiYSIsInJlbGVhc2VJZCI6NDE4Njc0OTQ2LCJzZXF1ZW5jZSI6MTYsImJyYW5jaCI6InJlbGVhc2UtdHJhbnNmZXItdjAuOS4xNCIsImFjdGlvbiI6Im9uZSBjbG91ZCBieXRlIHRyYW5zZmVyIGZvciBzaXggcGFja2FnZXMgYW5kIHRlbiBvZmZpY2lhbCBib2R5IHJlYWRiYWNrcyIsImF1dGhvcml6ZWRCeSI6Ii9yb290IiwiZXhwbGljaXRBdXRob3JpemF0aW9uIjp0cnVlLCJvYnNlcnZlZEF0IjoiMjAyNi0xMC0yMFQxNzo0OTo1NS4wODdaIiwibG9jYWxVcGxvYWRlcnNBYnNlbnQiOnRydWUsIm9yaWdpbmFsVXBsb2FkQXR0ZW1wdHNQcmVzZXJ2ZWQiOnRydWUsInN0YXJ0ZXJzUmVtb3ZlZCI6dHJ1ZSwibm9BdXRvbWF0aWNSZXRyeSI6dHJ1ZSwic2l4TWlycm9yUGFja2FnZXNSZWFkeSI6dHJ1ZSwibWV0YWRhdGFBbHJlYWR5VXBsb2FkZWRBbmRGcm96ZW4iOnRydWUsImRyYWZ0T25seSI6dHJ1ZSwib3JpZ2luYWxHaEh0dHBQb3N0Q291bnQiOiJ1bmtub3duIiwiY2xvdWRSdW5BdHRlbXB0IjoxLCJuZXdDbG91ZFBlckFzc2V0UG9zdExpbWl0IjoxLCJhbGxvd2VkUG9zdE5hbWVzIjpbIlBldFBhbC0wLjkuMTQtV2luZG93cy14NjQuZXhlIiwiUGV0UGFsLTAuOS4xNC1XaW5kb3dzLXg2NC56aXAiLCJQZXRQYWwtMC45LjE0LVVidW50dS14NjQudGFyLmd6IiwiUGV0UGFsLTAuOS4xNC1VYnVudHUtYXJtNjQudGFyLmd6IiwiUGV0UGFsLTAuOS4xNC1BbmRyb2lkLWRlYnVnLmFwayIsIlBldFBhbC0wLjkuMTQtV2ViLnppcCJdLCJjb21wbGV0ZWRBc3NldHMiOlt7ImlkIjo2NjAwMjA4NDIsIm5hbWUiOiJyZWxlYXNlLW1hbmlmZXN0Lmpzb24iLCJzaXplIjoyMDQ4LCJkaWdlc3QiOiJzaGEyNTY6OGMyYWQwMTMxZWMwYzJmNGRkZTlkYmM3OWIwMDE4YTlmMzdmYjFkYTg4NjhjMDZiYjdhOWE2MDU5YjMzZDljZCJ9LHsiaWQiOjY2MDAyMDg0MywibmFtZSI6IlNIQTI1NlNVTVMudHh0Iiwic2l6ZSI6NTc2LCJkaWdlc3QiOiJzaGEyNTY6Yjk1MDAwYzUyYTM1MDMwMWM2MjMzYzcyZmMzNWNkZjA4ODA1NWYyYmU3OGRhNjgxNTMzMmYzMWViZDZhOTk3MCJ9LHsiaWQiOjY2MDAyMDg0NCwibmFtZSI6InBldHBhbC11cGRhdGUuanNvbiIsInNpemUiOjEwMjczLCJkaWdlc3QiOiJzaGEyNTY6MDcwMzM5Yzc0ZjQzYjZmY2M3MDEzZGMzODZjNzMzZjE3ZmUyMmJlOGNhODcxMDIxNzNhYTAyMDliMDEwM2ZmNCJ9LHsiaWQiOjY2MDAyMDg0NiwibmFtZSI6InBldHBhbC11cGRhdGUtcHVibGljLWtleS50eHQiLCJzaXplIjoxMTMsImRpZ2VzdCI6InNoYTI1Njo3ZmQ2NTBhZmU1ZTVhN2UxZDM1ZTBmMjUxNWUwZWU3YjYwNGFhM2RlYzdiODI1MzU5M2M0ODVhM2ZhOGZlYmRiIn1dLCJldmlkZW5jZSI6W3sicGF0aCI6Ii5kYXRhL3JlbGVhc2UtMC45LjE0L3RyYW5zZmVyLXNvdXJjZS9wcm9vZnMvZ2l0aHViLW93bmVkLXVwbG9hZC1zdG9wLmpzb24iLCJzaGEyNTYiOiJhZTYwZmU2YTdiMjhhZmQ1Zjg0MTU0M2ZmY2MwM2QyM2VlZjA3MDk4MGI1OGJhNjFhODlhMmJiNGM0NzVkZGIwIn0seyJwYXRoIjoiLmRhdGEvcmVsZWFzZS0wLjkuMTQvdHJhbnNmZXItc291cmNlL3Byb29mcy9naXRodWItb3duZWQtd2ViLXVwbG9hZC1zdG9wLmpzb24iLCJzaGEyNTYiOiIzOGFiYzUyOGQ0MGZjMDEzNTI0NzRmODZlM2I0MWM0YjE4NTUyYzljNjhlZjU1NmVhZWY1MWIwNzQwNTk3ZGNhIn0seyJwYXRoIjoiLmRhdGEvcmVsZWFzZS0wLjkuMTQvdHJhbnNmZXItc291cmNlL3Byb29mcy9naXRodWItc3RhcnRlci1jbGVhbnVwLmpzb24iLCJzaGEyNTYiOiJhZjJkY2EzY2NjYWYzODMxMzIzNGRlODBmYjc2ZTU3MjUwZGI1MmVhMTYwMWQ4YTY4Y2JhZTA5NjdhOGMwOWJlIn0seyJwYXRoIjoiLmRhdGEvcmVsZWFzZS0wLjkuMTQvdHJhbnNmZXItc291cmNlL3Byb29mcy9naXRodWItbWV0YWRhdGEtdXBsb2FkLmpzb24iLCJzaGEyNTYiOiJhZWExZTZkYWViYWYwZDdhNmJlZDNiZTk5ZWNkZjEyNGQ0ZWJlNDIyZjUyOWIzZDcyZDdlMTFhZTEwMjdmZWZiIn0seyJwYXRoIjoiLmRhdGEvcmVsZWFzZS0wLjkuMTQvdHJhbnNmZXItc291cmNlL3Byb29mcy9naXRodWItdHVubmVsLWNsZWFudXAuanNvbiIsInNoYTI1NiI6IjU4MjU5NWQxNzhmNTk0ZDhlMDE4NmQwMzgwMjliMzMzNjE2OWYwNGM2ZDE5Y2VmMDZjZTIxOWMxOGYwODlmZDAifSx7InBhdGgiOiIuZGF0YS9yZWxlYXNlLTAuOS4xNC90cmFuc2Zlci1zb3VyY2UvcHJvb2ZzL2ZyZXNoLXByb2R1Y3Rpb24uanNvbiIsInNoYTI1NiI6ImIyODY5MWZkYmFhM2YzY2MyYWI4ZWMzYWM4OGZkOWQ0NWYzMDZhN2M1MThiZDJiZWNkZDczNDA1OWVhNmNkYjUifSx7InBhdGgiOiIuZGF0YS9yZWxlYXNlLTAuOS4xNC90cmFuc2Zlci1zb3VyY2UvcHJvb2ZzL2xvY2FsLXVwbG9hZGVycy5qc29uIiwic2hhMjU2IjoiNTRmNzBlOTgwOWMzNWVmNDdiYWE1NGRmMDdjMTEzYmI1ZmU5ODM1NTA2ZmQ5YWFkMzI3ZjNhMTgxOWY2MTFlZSJ9LHsicGF0aCI6Ii5kYXRhL3JlbGVhc2UtMC45LjE0L3ByZXBhcmVkL3JlY2VpcHRzL3NlcnZlci1yZWFkYmFjay5qc29uIiwic2hhMjU2IjoiODU3YWFiM2Q1MjQyYTc1NmVjNDczZTMxMjgyYTE4ZjA2M2RiMjJlNTVmNDVlYzg2ZGVjNjQzNzczNmYzYzI4NCJ9LHsicGF0aCI6Ii5kYXRhL3JlbGVhc2UtMC45LjE0L3ByZXBhcmVkL3JlY2VpcHRzL3NlcnZlci1leHRyYS16aXAtcmVhZGJhY2suanNvbiIsInNoYTI1NiI6IjAxZmUzMTA1ODQ3ODZmZDFmZWUwODhlMzMyOWJjMTMyMjY0Y2YwYjI2ZDhiNTE5ODg0NWFjMDU1Yzk3MGVjMDcifSx7InBhdGgiOiIuZGF0YS9yZWxlYXNlLTAuOS4xNC9wcmVwYXJlZC9yZWNlaXB0cy9zaWduZWQuanNvbiIsInNoYTI1NiI6IjZjZTI0MDBlNmJlMjVjYjZlN2IzODIzMzRmMDA1NTQ5ZWJjZWQ0MTY3YTFjNDUwNGQ2YTMyZmU5ZGM2YzU5YTIifV0sInJldmlld2VkVGVtcGxhdGVzU2hhMjU2IjoiNDE2OTUxODJmYzNiOWEwZGFiMDllNTI2NWUwMjZmYjU5MjgzZDFkZjQ0ZGE0ZDRiMDhjZGFmNmY5MjhmOGE5YiIsInByb2R1Y3Rpb25Db250ZXh0Ijp7ImJhY2tlbmRWZXJzaW9uIjoiMC45LjE0IiwiY2F0YWxvZ1ZlcnNpb24iOiJtaXhlZC1sZWdhY3kiLCJkb3dubG9hZFZlcnNpb25zIjp7ImFuZHJvaWQiOiIwLjkuMTMiLCJ3ZWIiOiIwLjkuMTMiLCJ3aW5kb3dzIjoiMC45LjEyIiwidWJ1bnR1IjoiMC45LjEyIn0sInVwZGF0ZVNlcXVlbmNlIjoxNSwiY2F0YWxvZ1Byb21vdGVkIjpmYWxzZX19","rootGateSha256":"f1a99d11cf5dfaf343d4647b544eba4764d4acb8d6c3ff35b7641d17bd6c3100"};
export const REPOSITORY='lixinyu02/petpal',TAG='v0.9.14',SOURCE='7b8f84f5b3962efaebbacb3d5af72cecdc790e59',BRANCH='release-transfer-v0.9.14',DRAFT_RELEASE_ID=418674946;
export const PACKAGE_NAMES=['PetPal-0.9.14-Windows-x64.exe','PetPal-0.9.14-Windows-x64.zip','PetPal-0.9.14-Ubuntu-x64.tar.gz','PetPal-0.9.14-Ubuntu-arm64.tar.gz','PetPal-0.9.14-Android-debug.apk','PetPal-0.9.14-Web.zip'];
export const METADATA_NAMES=['release-manifest.json','SHA256SUMS.txt','petpal-update.json','petpal-update-public-key.txt'];
export const CONTRACT_HASH='62a0d6e5dc2f4e57bff58f02523c0443870ba88911aa74c9f83d02dd66b0cbeb',PLAN_HASH='03ab80582827483fcc805d858366eae4ce965896a47efaf0ea1f4f1541dac7ba';
const API='https://api.github.com/repos/'+REPOSITORY;
class TransferError extends Error {}
const need=(value,code)=>{if(!value)throw new TransferError(code);};
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const exact=(asset,target)=>asset?.name===target.name&&asset.state==='uploaded'&&asset.size===target.size&&asset.digest==='sha256:'+target.sha256;
export function validatePlan(plan){
 const {localPlanHash,rootGate,rootGateBytes,rootGateSha256,...core}=plan||{};
 need(sha256(Buffer.from(JSON.stringify(core)))===PLAN_HASH,'frozen-plan-bytes-mismatch');
 need(plan?.schemaVersion===1&&plan.repository===REPOSITORY&&plan.tag===TAG&&plan.sourceRevision===SOURCE&&plan.branch===BRANCH&&plan.prerelease===false&&plan.mode==='https-mirror'&&plan.releaseId===DRAFT_RELEASE_ID&&plan.stableLatest==='v0.9.13'&&plan.stableLatestId===414528577&&plan.sequence===16,'frozen-plan-identity-mismatch');
 need(plan.contractHash===CONTRACT_HASH&&plan.localPlanHash===PLAN_HASH,'contract-or-plan-hash-mismatch');
 need(Array.isArray(plan.assets)&&plan.assets.length===10&&JSON.stringify(plan.targets)===JSON.stringify([...PACKAGE_NAMES,...METADATA_NAMES]),'frozen-asset-set-mismatch');
 const seen=new Set();for(const asset of plan.assets){need(plan.targets.includes(asset.name)&&!seen.has(asset.name)&&Number.isSafeInteger(asset.size)&&asset.size>0&&asset.size<=2*1024**3&&/^[a-f0-9]{64}$/.test(asset.sha256),'frozen-asset-invalid');seen.add(asset.name);}
 need(!Object.hasOwn(plan,'inlineMetadata'),'inline-metadata-forbidden');
 need(plan.mirrorBaseUrl==='https://magicdatou.top:44318/downloads/updates/','mirror-base-invalid');
 need(plan.completedAssets?.length===4&&JSON.stringify(plan.completedAssets.map(a=>a.name))===JSON.stringify(METADATA_NAMES)&&new Set(plan.completedAssets.map(a=>a.id)).size===4,'completed-set-invalid');
 for(const row of plan.completedAssets){const target=plan.assets.find(a=>a.name===row.name);need(Number.isSafeInteger(row.id)&&row.id>0&&row.size===target.size&&row.digest==='sha256:'+target.sha256,'completed-identity-invalid');}
 need(plan.rootGate?.authorizedBy==='/root'&&plan.rootGate.explicitAuthorization===true&&plan.rootGate.localUploadersAbsent===true&&plan.rootGate.originalUploadAttemptsPreserved===true&&plan.rootGate.startersRemoved===true&&plan.rootGate.noAutomaticRetry===true&&plan.rootGate.sixMirrorPackagesReady===true&&plan.rootGate.metadataAlreadyUploadedAndFrozen===true&&plan.rootGate.draftOnly===true&&plan.rootGate.reviewedTemplatesSha256===plan.reviewedTemplatesSha256&&/^[a-f0-9]{64}$/.test(plan.rootGateSha256||'')&&sha256(Buffer.from(plan.rootGateBytes,'base64'))===plan.rootGateSha256,'root-gate-invalid');
 need(JSON.stringify(JSON.parse(Buffer.from(plan.rootGateBytes,'base64')) )===JSON.stringify(plan.rootGate),'root-gate-bytes-mismatch');
 need(JSON.stringify(plan.productionContext)===JSON.stringify({"backendVersion":"0.9.14","catalogVersion":"mixed-legacy","downloadVersions":{"android":"0.9.13","web":"0.9.13","windows":"0.9.12","ubuntu":"0.9.12"},"updateSequence":15,"catalogPromoted":false})&&JSON.stringify(plan.rootGate.productionContext)===JSON.stringify(plan.productionContext),'production-context-mismatch');
 need(/^[a-f0-9]{64}$/.test(plan.reviewedTemplatesSha256||''),'reviewed-templates-hash-invalid');
 for(const[key,value]of Object.entries({schemaVersion:1,version:'0.9.14',sourceRevision:SOURCE,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,releaseId:DRAFT_RELEASE_ID,sequence:16,branch:BRANCH,action:'one cloud byte transfer for six packages and ten official body readbacks',originalGhHttpPostCount:'unknown',cloudRunAttempt:1,newCloudPerAssetPostLimit:1}))need(plan.rootGate[key]===value,'root-gate-identity-mismatch');
 need(JSON.stringify(plan.rootGate.allowedPostNames)===JSON.stringify(PACKAGE_NAMES)&&JSON.stringify(plan.rootGate.completedAssets)===JSON.stringify(plan.completedAssets),'root-gate-asset-scope-mismatch');
 need(Array.isArray(plan.rootGate.evidence)&&plan.rootGate.evidence.length>=5&&new Set(plan.rootGate.evidence.map(e=>e.path)).size===plan.rootGate.evidence.length,'root-evidence-set-invalid');
 for(const row of plan.rootGate.evidence){need(typeof row.path==='string'&&(row.path.startsWith('.data/release-0.9.14/prepared/receipts/')||row.path.startsWith('.data/release-0.9.14/transfer-source/proofs/'))&&!row.path.includes('..')&&/^[a-f0-9]{64}$/.test(row.sha256),'root-evidence-invalid');}
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
 const work=path.join(env.RUNNER_TEMP,'petpal-0914-cloud-'+env.GITHUB_RUN_ID);await mkdir(work,{mode:0o700});
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
