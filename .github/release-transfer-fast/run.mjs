// Standalone cloud byte transfer. Only a generated, frozen PINNED plan may execute.
import {createHash} from 'node:crypto';
import {downloadRanges,RangeDownloadError} from './range-download.mjs';
import {createReadStream} from 'node:fs';
import {readFile,mkdir,open,stat} from 'node:fs/promises';
import {getDefaultAutoSelectFamilyAttemptTimeout,setDefaultAutoSelectFamilyAttemptTimeout} from 'node:net';
import {getDefaultResultOrder,setDefaultResultOrder} from 'node:dns';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PINNED = {"repository":"lixinyu02/petpal","tag":"v0.9.10","sourceRevision":"d2ded9c66aad81310d8d40baa74761a3a8242242","contractHash":"3375001b0afe122ca855cdf12b2be4faf438ebcfd9679c5652a95bab1ecf1048","localPlanHash":"1fc4f7a675308dab3ec3f804d23db98bb56e589e6666c3b2078bd149fb57b63a","branch":"release-transfer-v0.9.10-fast","prerelease":false,"mode":"https-mirror","releaseId":404334344,"stableLatest":"v0.9.9","stableLatestId":403517961,"assets":[{"name":"PetPal-0.9.10-Windows-x64.exe","size":220939191,"sha256":"333945f282daeb02427ef8b722ec6b561f8da3b67e8e5dc051248a09e250a1dc"},{"name":"PetPal-0.9.10-Windows-x64.zip","size":373237878,"sha256":"ffed1893d470c47651644fe6897bff41d842a031d96d04268be9078f405e22d1"},{"name":"PetPal-0.9.10-Ubuntu-x64.tar.gz","size":343871928,"sha256":"912c50627fcaae105fa59dfbe91f5eb02da1c5843ca7bd8128803d9075afcf69"},{"name":"PetPal-0.9.10-Ubuntu-arm64.tar.gz","size":338056406,"sha256":"8b16fd1ff0bc649f1d59a55ee1f55a5ef95e764ed92a7cd8be4cc217c1e7e7d1"},{"name":"PetPal-0.9.10-Android-debug.apk","size":60732669,"sha256":"f8ba3c8613a4ff0abea9106e5d38f37ce57dd390c99b20957f8c246bb9513863"},{"name":"PetPal-0.9.10-Web.zip","size":55945807,"sha256":"ccb7cb400bbdee2aa734e14e966a1af7cb3cf438c91e01194cb677b21c55714c"},{"name":"release-manifest.json","size":2035,"sha256":"a8efcf08e826f4ec03de8f6c09fd716fe9090e5a0079966ee85803b67f736456"},{"name":"SHA256SUMS.txt","size":576,"sha256":"7a69985ff16b5f9a35b9463b50a6546db07fe850df8f54d927c76c451ddb52f5"},{"name":"petpal-update.json","size":3193,"sha256":"cbe98f7cfda17308d347979e3c69a3274215a89daee40f47eeff46e9c4025a7d"},{"name":"petpal-update-public-key.txt","size":113,"sha256":"7fd650afe5e5a7e1d35e0f2515e0ee7b604aa3dec7b8253593c485a3fa8febdb"}],"targets":["PetPal-0.9.10-Windows-x64.exe","PetPal-0.9.10-Windows-x64.zip","PetPal-0.9.10-Ubuntu-x64.tar.gz","PetPal-0.9.10-Ubuntu-arm64.tar.gz","PetPal-0.9.10-Android-debug.apk","PetPal-0.9.10-Web.zip","release-manifest.json","SHA256SUMS.txt","petpal-update.json","petpal-update-public-key.txt"],"inlineMetadata":{"release-manifest.json":"ewogICJjcmVhdGVkQXQiOiAiMjAyNi0xMC0wNlQwNTowMjo1My41NDVaIiwKICAidmVyc2lvbiI6ICIwLjkuMTAiLAogICJjaGFubmVsIjogInN0YWJsZSIsCiAgInNvdXJjZVJldmlzaW9uIjogImQyZGVkOWM2NmFhZDgxMzEwZDhkNDBiYWE3NDc2MWEzYTgyNDIyNDIiLAogICJmaWxlcyI6IFsKICAgIHsKICAgICAgIm5hbWUiOiAiUGV0UGFsLTAuOS4xMC1XaW5kb3dzLXg2NC5leGUiLAogICAgICAidGFyZ2V0IjogIndpbmRvd3MteDY0IiwKICAgICAgImJ5dGVzIjogMjIwOTM5MTkxLAogICAgICAic2hhMjU2IjogIjMzMzk0NWYyODJkYWViMDI0MjdlZjhiNzIyZWM2YjU2MWY4ZGEzYjY3ZThlNWRjMDUxMjQ4YTA5ZTI1MGExZGMiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJQZXRQYWwtMC45LjEwLVdpbmRvd3MteDY0LnppcCIsCiAgICAgICJ0YXJnZXQiOiAid2luZG93cy14NjQiLAogICAgICAiYnl0ZXMiOiAzNzMyMzc4NzgsCiAgICAgICJzaGEyNTYiOiAiZmZlZDE4OTNkNDcwYzQ3NjUxNjQ0ZmU2ODk3YmZmNDFkODQyYTAzMWQ5NmQwNDI2OGJlOTA3OGY0MDVlMjJkMSIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogIlBldFBhbC0wLjkuMTAtVWJ1bnR1LXg2NC50YXIuZ3oiLAogICAgICAidGFyZ2V0IjogInVidW50dS14NjQiLAogICAgICAiYnl0ZXMiOiAzNDM4NzE5MjgsCiAgICAgICJzaGEyNTYiOiAiOTEyYzUwNjI3ZmNhYWUxMDVmYTU5ZGZiZTkxZjVlYjAyZGExYzU4NDNjYTdiZDgxMjg4MDNkOTA3NWFmY2Y2OSIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogIlBldFBhbC0wLjkuMTAtVWJ1bnR1LWFybTY0LnRhci5neiIsCiAgICAgICJ0YXJnZXQiOiAidWJ1bnR1LWFybTY0IiwKICAgICAgImJ5dGVzIjogMzM4MDU2NDA2LAogICAgICAic2hhMjU2IjogIjhiMTZmZDFmZjBiYzY0OWYxZDU5YTU1ZWUxZjU1YTVlZjk1ZTc2NGVkOTJhN2NkOGJlNGNjMjE3YzFlN2U3ZDEiCiAgICB9LAogICAgewogICAgICAibmFtZSI6ICJQZXRQYWwtMC45LjEwLUFuZHJvaWQtZGVidWcuYXBrIiwKICAgICAgInRhcmdldCI6ICJhbmRyb2lkIiwKICAgICAgImJ5dGVzIjogNjA3MzI2NjksCiAgICAgICJzaGEyNTYiOiAiZjhiYTNjODYxM2E0ZmYwYWJlYTkxMDZlNWQzOGYzN2NlNTdkZDM5MGM5OWIyMDk1N2Y4YzI0NmJiOTUxMzg2MyIKICAgIH0sCiAgICB7CiAgICAgICJuYW1lIjogIlBldFBhbC0wLjkuMTAtV2ViLnppcCIsCiAgICAgICJ0YXJnZXQiOiAid2ViIiwKICAgICAgImJ5dGVzIjogNTU5NDU4MDcsCiAgICAgICJzaGEyNTYiOiAiY2NiN2NiNDAwYmJkZWUyYWE3MzRlMTRlOTY2YTFhZjdjYjNjZjQzOGM5MWUwMTE5NGNiNjc3YjIxYzU1NzE0YyIKICAgIH0KICBdLAogICJjb2RleENsaVZlcnNpb24iOiAiMC4xNDMuMCIsCiAgIm9wZW5jbGlWZXJzaW9uIjogIjEuOC44IiwKICAiZWxlY3Ryb25WZXJzaW9uIjogIjM5LjguMTAiLAogICJhbmRyb2lkVmVyc2lvbkNvZGUiOiAyMCwKICAiYW5kcm9pZFNpZ25hdHVyZSI6ICJzYW1lLWRldmVsb3BtZW50LWNlcnRpZmljYXRlLWFzLTAuOS45IiwKICAiYW5kcm9pZFNpZ25pbmdDZXJ0aWZpY2F0ZSI6ICI4YWU0OWVlNmIwOTkwMGVlZTJlMjk5NmEwYzRlY2Q2NTlmOTQ2MzFmODFiNjRjNWRmN2ZiNTM5MzU4MzU3MTNjIiwKICAid2luZG93c0F1dGhlbnRpY29kZSI6ICJOb3RTaWduZWQiLAogICJhY2NlcHRhbmNlIjogewogICAgIndpbmRvd3NBY3R1YWxTdGFydHVwIjogdHJ1ZSwKICAgICJ3aW5kb3dzWmlwUmVwZWF0ZWRTdGFydHVwIjogdHJ1ZSwKICAgICJ3aW5kb3dzWmlwRnVsbEdlc3R1cmVTbW9rZSI6IGZhbHNlLAogICAgInVidW50dUZ1bGxBcmNoaXZlQnl0ZXNWZXJpZmllZCI6IHRydWUsCiAgICAiYW5kcm9pZEFyY2hpdmVBdWRpdCI6IHRydWUsCiAgICAid2ViRnVsbEFyY2hpdmVCeXRlc1ZlcmlmaWVkIjogdHJ1ZSwKICAgICJwcml2YXRlRGF0YVNjYW4iOiB0cnVlLAogICAgInVidW50dVJ1bnRpbWVWZXJpZmllZCI6IGZhbHNlLAogICAgImFuZHJvaWREZXZpY2VWZXJpZmllZCI6IGZhbHNlCiAgfQp9Cg==","SHA256SUMS.txt":"MzMzOTQ1ZjI4MmRhZWIwMjQyN2VmOGI3MjJlYzZiNTYxZjhkYTNiNjdlOGU1ZGMwNTEyNDhhMDllMjUwYTFkYyAgUGV0UGFsLTAuOS4xMC1XaW5kb3dzLXg2NC5leGUKZmZlZDE4OTNkNDcwYzQ3NjUxNjQ0ZmU2ODk3YmZmNDFkODQyYTAzMWQ5NmQwNDI2OGJlOTA3OGY0MDVlMjJkMSAgUGV0UGFsLTAuOS4xMC1XaW5kb3dzLXg2NC56aXAKOTEyYzUwNjI3ZmNhYWUxMDVmYTU5ZGZiZTkxZjVlYjAyZGExYzU4NDNjYTdiZDgxMjg4MDNkOTA3NWFmY2Y2OSAgUGV0UGFsLTAuOS4xMC1VYnVudHUteDY0LnRhci5nego4YjE2ZmQxZmYwYmM2NDlmMWQ1OWE1NWVlMWY1NWE1ZWY5NWU3NjRlZDkyYTdjZDhiZTRjYzIxN2MxZTdlN2QxICBQZXRQYWwtMC45LjEwLVVidW50dS1hcm02NC50YXIuZ3oKZjhiYTNjODYxM2E0ZmYwYWJlYTkxMDZlNWQzOGYzN2NlNTdkZDM5MGM5OWIyMDk1N2Y4YzI0NmJiOTUxMzg2MyAgUGV0UGFsLTAuOS4xMC1BbmRyb2lkLWRlYnVnLmFwawpjY2I3Y2I0MDBiYmRlZTJhYTczNGUxNGU5NjZhMWFmN2NiM2NmNDM4YzkxZTAxMTk0Y2I2NzdiMjFjNTU3MTRjICBQZXRQYWwtMC45LjEwLVdlYi56aXAK","petpal-update.json":"ewogICJzY2hlbWFWZXJzaW9uIjogMSwKICAicGF5bG9hZCI6ICJleUp3Y205a2RXTjBJam9pY0dWMGNHRnNJaXdpWTJoaGJtNWxiQ0k2SW5OMFlXSnNaU0lzSW5ObGNYVmxibU5sSWpveE1pd2lhWE56ZFdWa1FYUWlPaUl5TURJMkxURXdMVEEyVkRBMU9qQXlPalV6TGpVMU4xb2lMQ0psZUhCcGNtVnpRWFFpT2lJeU1ESTNMVEV3TFRBMlZEQXdPakF3T2pBd1dpSXNJbkpsYkdWaGMyVnpJanBiZXlKcFpDSTZJbmRwYm1SdmQzTXRlRFkwTFRBdU9TNHhNQ0lzSW5SaGNtZGxkQ0k2SW5kcGJtUnZkM010ZURZMElpd2lkbVZ5YzJsdmJpSTZJakF1T1M0eE1DSXNJblZ5YkNJNkltaDBkSEJ6T2k4dloybDBhSFZpTG1OdmJTOXNhWGhwYm5sMU1ESXZjR1YwY0dGc0wzSmxiR1ZoYzJWekwyUnZkMjVzYjJGa0wzWXdMamt1TVRBdlVHVjBVR0ZzTFRBdU9TNHhNQzFYYVc1a2IzZHpMWGcyTkM1bGVHVWlMQ0ppZVhSbGN5STZNakl3T1RNNU1Ua3hMQ0p6YUdFeU5UWWlPaUl6TXpNNU5EVm1Namd5WkdGbFlqQXlOREkzWldZNFlqY3lNbVZqTm1JMU5qRm1PR1JoTTJJMk4yVTRaVFZrWXpBMU1USTBPR0V3T1dVeU5UQmhNV1JqSWl3aWJtOTBaWE1pT2lJd0xqa3VNVEFnNXEyajVieVA1NG1JNzd5YTZLLXQ2Wi16NW9tVDVwYXQ0NENCNVpDTzVZLXdJRUZuWlc1MElPaV9tLVc2cHVTNGp1V3VqT2FJa09heGgtYUtwZU9BZ2VXdnVlaXZuZVc5a3VhaG95X21nYUxscEkwdjZZZU41Wkc5NVpDTkwtV0lvT21acE8tOGpPUzdwZVdQaXVpMHB1V1B0LW1odWVlYnJ1V0lodWV4dS1PQWdpSXNJbVp2Y20xaGRDSTZJbkJ2Y25SaFlteGxMV1Y0WlNKOUxIc2lhV1FpT2lKMVluVnVkSFV0ZURZMExUQXVPUzR4TUNJc0luUmhjbWRsZENJNkluVmlkVzUwZFMxNE5qUWlMQ0oyWlhKemFXOXVJam9pTUM0NUxqRXdJaXdpZFhKc0lqb2lhSFIwY0hNNkx5OW5hWFJvZFdJdVkyOXRMMnhwZUdsdWVYVXdNaTl3WlhSd1lXd3ZjbVZzWldGelpYTXZaRzkzYm14dllXUXZkakF1T1M0eE1DOVFaWFJRWVd3dE1DNDVMakV3TFZWaWRXNTBkUzE0TmpRdWRHRnlMbWQ2SWl3aVlubDBaWE1pT2pNME16ZzNNVGt5T0N3aWMyaGhNalUySWpvaU9URXlZelV3TmpJM1ptTmhZV1V4TURWbVlUVTVaR1ppWlRreFpqVmxZakF5WkdFeFl6VTRORE5qWVRkaVpEZ3hNamc0TUROa09UQTNOV0ZtWTJZMk9TSXNJbTV2ZEdWeklqb2lNQzQ1TGpFd0lPYXRvLVc4ai1lSmlPLThtdWl2cmVtZnMtYUprLWFXcmVPQWdlV1FqdVdQc0NCQloyVnVkQ0RvdjV2bHVxYmt1STdscm96bWlKRG1zWWZtaXFYamdJSGxyN25vcjUzbHZaTG1vYU12NW9HaTVhU05MLW1IamVXUnZlV1FqU19saUtEcG1hVHZ2SXprdTZYbGo0cm90S2JsajdmcG9ibm5tNjdsaUlibnNidmpnSUlpTENKbWIzSnRZWFFpT2lKMFlYSXVaM29pZlN4N0ltbGtJam9pZFdKMWJuUjFMV0Z5YlRZMExUQXVPUzR4TUNJc0luUmhjbWRsZENJNkluVmlkVzUwZFMxaGNtMDJOQ0lzSW5abGNuTnBiMjRpT2lJd0xqa3VNVEFpTENKMWNtd2lPaUpvZEhSd2N6b3ZMMmRwZEdoMVlpNWpiMjB2YkdsNGFXNTVkVEF5TDNCbGRIQmhiQzl5Wld4bFlYTmxjeTlrYjNkdWJHOWhaQzkyTUM0NUxqRXdMMUJsZEZCaGJDMHdMamt1TVRBdFZXSjFiblIxTFdGeWJUWTBMblJoY2k1bmVpSXNJbUo1ZEdWeklqb3pNemd3TlRZME1EWXNJbk5vWVRJMU5pSTZJamhpTVRabVpERm1aakJpWXpZME9XWXhaRFU1WVRVMVpXVXhaalUxWVRWbFpqazFaVGMyTkdWa09USmhOMk5rT0dKbE5HTmpNakUzWXpGbE4yVTNaREVpTENKdWIzUmxjeUk2SWpBdU9TNHhNQ0RtcmFQbHZJX25pWWp2dkpyb3I2M3BuN1BtaVpQbWxxM2pnSUhsa0k3bGo3QWdRV2RsYm5RZzZMLWI1YnFtNUxpTzVhNk01b2lRNXJHSDVvcWw0NENCNWEtNTZLLWQ1YjJTNXFHakwtYUJvdVdralNfcGg0M2xrYjNsa0kwdjVZaWc2Wm1rNzd5TTVMdWw1WS1LNkxTbTVZLTM2YUc1NTV1dTVZaUc1N0c3NDRDQ0lpd2labTl5YldGMElqb2lkR0Z5TG1kNkluMHNleUpwWkNJNkltRnVaSEp2YVdRdE1DNDVMakV3SWl3aWRHRnlaMlYwSWpvaVlXNWtjbTlwWkNJc0luWmxjbk5wYjI0aU9pSXdMamt1TVRBaUxDSjJaWEp6YVc5dVEyOWtaU0k2TWpBc0luVnliQ0k2SW1oMGRIQnpPaTh2WjJsMGFIVmlMbU52YlM5c2FYaHBibmwxTURJdmNHVjBjR0ZzTDNKbGJHVmhjMlZ6TDJSdmQyNXNiMkZrTDNZd0xqa3VNVEF2VUdWMFVHRnNMVEF1T1M0eE1DMUJibVJ5YjJsa0xXUmxZblZuTG1Gd2F5SXNJbUo1ZEdWeklqbzJNRGN6TWpZMk9Td2ljMmhoTWpVMklqb2laamhpWVROak9EWXhNMkUwWm1Zd1lXSmxZVGt4TURabE5XUXpPR1l6TjJObE5UZGtaRE01TUdNNU9XSXlNRGsxTjJZNFl6STBObUppT1RVeE16ZzJNeUlzSW01dmRHVnpJam9pTUM0NUxqRXdJT2F0by1XOGotZUppTy04bXVpdnJlbWZzLWFKay1hV3JlT0FnZVdRanVXUHNDQkJaMlZ1ZENEb3Y1dmx1cWJrdUk3bHJvem1pSkRtc1lmbWlxWGpnSUhscjdub3I1M2x2Wkxtb2FNdjVvR2k1YVNOTC1tSGplV1J2ZVdRalNfbGlLRHBtYVR2dkl6a3U2WGxqNHJvdEtibGo3ZnBvYm5ubTY3bGlJYm5zYnZqZ0lJaUxDSm1iM0p0WVhRaU9pSmhjR3NpZlN4N0ltbGtJam9pZDJWaUxUQXVPUzR4TUNJc0luUmhjbWRsZENJNkluZGxZaUlzSW5abGNuTnBiMjRpT2lJd0xqa3VNVEFpTENKMWNtd2lPaUpvZEhSd2N6b3ZMMmRwZEdoMVlpNWpiMjB2YkdsNGFXNTVkVEF5TDNCbGRIQmhiQzl5Wld4bFlYTmxjeTlrYjNkdWJHOWhaQzkyTUM0NUxqRXdMMUJsZEZCaGJDMHdMamt1TVRBdFYyVmlMbnBwY0NJc0ltSjVkR1Z6SWpvMU5UazBOVGd3Tnl3aWMyaGhNalUySWpvaVkyTmlOMk5pTkRBd1ltSmtaV1V5WVdFM016UmxNVFJsT1RZMllURmhaamRqWWpOalpqUXpPR001TVdVd01URTVOR05pTmpjM1lqSXhZelUxTnpFMFl5SXNJbTV2ZEdWeklqb2lNQzQ1TGpFd0lPYXRvLVc4ai1lSmlPLThtdWl2cmVtZnMtYUprLWFXcmVPQWdlV1FqdVdQc0NCQloyVnVkQ0RvdjV2bHVxYmt1STdscm96bWlKRG1zWWZtaXFYamdJSGxyN25vcjUzbHZaTG1vYU12NW9HaTVhU05MLW1IamVXUnZlV1FqU19saUtEcG1hVHZ2SXprdTZYbGo0cm90S2JsajdmcG9ibm5tNjdsaUlibnNidmpnSUlpTENKbWIzSnRZWFFpT2lKM1pXSXRlbWx3SW4xZGZRIiwKICAic2lnbmF0dXJlIjogIjlLbmotSUI3Tzgzcm51alNweWFMVUs4amZzaDBiTVhtci00TnFoOXFjYkN2eVRmVkVJVVNDWG9KTXIwSVQ2Zk8wSFhTSFV4TjlnZ2dpeDNxaDN4NkRBIgp9Cg==","petpal-update-public-key.txt":"LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQWJhaXZyeWgxVlh2T3ZndmZxOFEzUERmaEFsTVJDQzBadjBjcFNDY2NwNjg9Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo="},"priorUploadReservations":[{"file":"github-upload-PetPal-0.9.10-Windows-x64.exe.attempt.json","name":"PetPal-0.9.10-Windows-x64.exe","sha256":"cf39eb9e9cb6a7638871bf7bdaf59dbf32e5b16a9d6a5fc1ce94d3fd29aeb9c5"}],"reuseOnlyNames":[],"recoveryAuthorizedNames":["PetPal-0.9.10-Windows-x64.exe"],"recoveryAuthorization":{"generation":3,"authorizedBy":"/root","authorizationSha256":"98b6dce9b4a8e08c8c1f9574ab1858440d1a02a4c6ad9e40c0295f5a044de914","postExitGetEvidenceSha256":"6190abb77d247144c75f1e3b60e241ac192e518ffcf7459bba648284d73ad212"},"fastOriginalCloud":{"originalRunId":37419799452,"originalHead":"d4ec0b348e5d7c2710394c695adf745202d94763","originalLogSha256":"6279b9a0dab679ba5f89fb02b16fb1ae8b84d5009542ac07f6f61c74d8b193f5","originalEvidenceSha256":"6190abb77d247144c75f1e3b60e241ac192e518ffcf7459bba648284d73ad212","originalCandidateFileSha256":"e6a280f0c4cb7aa3ce8cec87a690a2e46dfbfc1cf2abdcaca47a97b0d6f4eae4","originalRunnerSha256":"9e0d77f49a796adee18024d36b04b51fff893fde357b110efb37622c4a41db47"}}; // Replaced exactly once by the reviewed local generator.
export const REPOSITORY='lixinyu02/petpal',TAG='v0.9.10',SOURCE='d2ded9c66aad81310d8d40baa74761a3a8242242',BRANCH='release-transfer-v0.9.10-fast',DRAFT_RELEASE_ID=404334344;
export const PACKAGE_NAMES=['PetPal-0.9.10-Windows-x64.exe','PetPal-0.9.10-Windows-x64.zip','PetPal-0.9.10-Ubuntu-x64.tar.gz','PetPal-0.9.10-Ubuntu-arm64.tar.gz','PetPal-0.9.10-Android-debug.apk','PetPal-0.9.10-Web.zip'];
export const METADATA_NAMES=['release-manifest.json','SHA256SUMS.txt','petpal-update.json','petpal-update-public-key.txt'];
export const CONTRACT_HASH='3375001b0afe122ca855cdf12b2be4faf438ebcfd9679c5652a95bab1ecf1048',PLAN_HASH='1fc4f7a675308dab3ec3f804d23db98bb56e589e6666c3b2078bd149fb57b63a';
const API=`https://api.github.com/repos/${REPOSITORY}`;
class TransferError extends Error {}
const need=(value,code)=>{if(!value)throw new TransferError(code);};
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const exact=(asset,target)=>asset?.name===target.name&&asset.state==='uploaded'&&asset.size===target.size&&asset.digest===`sha256:${target.sha256}`;
const mirrorUrl=name=>`https://magicdatou.top:44318/downloads/${name}`;

export function validatePlan(plan){
 need(plan?.repository===REPOSITORY&&plan.tag===TAG&&plan.sourceRevision===SOURCE&&plan.branch===BRANCH&&plan.prerelease===false&&plan.mode==='https-mirror','frozen-plan-identity-mismatch');
 need(Number.isSafeInteger(plan.releaseId)&&plan.releaseId===DRAFT_RELEASE_ID&&plan.releaseId!==403517961&&plan.stableLatest==='v0.9.9'&&plan.stableLatestId===403517961,'release-binding-invalid');
 need(plan.contractHash===CONTRACT_HASH&&plan.localPlanHash===PLAN_HASH,'contract-or-plan-hash-mismatch');
 need(Array.isArray(plan.assets)&&plan.assets.length===10&&Array.isArray(plan.targets)&&JSON.stringify(plan.targets)===JSON.stringify([...PACKAGE_NAMES,...METADATA_NAMES]),'frozen-asset-set-mismatch');
 const seen=new Set();
 for(const asset of plan.assets){need([...PACKAGE_NAMES,...METADATA_NAMES].includes(asset.name)&&!seen.has(asset.name)&&Number.isSafeInteger(asset.size)&&asset.size>0&&asset.size<=2*1024**3&&/^[a-f0-9]{64}$/.test(asset.sha256),'frozen-asset-invalid');seen.add(asset.name);}
 need(plan.inlineMetadata&&Object.keys(plan.inlineMetadata).length===4&&METADATA_NAMES.every(name=>Object.hasOwn(plan.inlineMetadata,name)),'metadata-set-invalid');
 for(const name of METADATA_NAMES){const target=plan.assets.find(asset=>asset.name===name),text=plan.inlineMetadata[name];need(typeof text==='string'&&text.length<=2*1024*1024&&/^[A-Za-z0-9+/]+={0,2}$/.test(text),'metadata-inline-invalid');const bytes=Buffer.from(text,'base64');need(bytes.length===target.size&&bytes.length<=1024*1024&&sha256(bytes)===target.sha256,'metadata-inline-bytes-mismatch');}
 need(Array.isArray(plan.reuseOnlyNames)&&new Set(plan.reuseOnlyNames).size===plan.reuseOnlyNames.length&&plan.reuseOnlyNames.every(name=>seen.has(name)),'reuse-only-set-invalid');
 need(Array.isArray(plan.recoveryAuthorizedNames)&&new Set(plan.recoveryAuthorizedNames).size===plan.recoveryAuthorizedNames.length&&plan.recoveryAuthorizedNames.every(name=>seen.has(name)&&!plan.reuseOnlyNames.includes(name)),'recovery-name-set-invalid');
 need(Array.isArray(plan.priorUploadReservations)&&plan.priorUploadReservations.length===plan.reuseOnlyNames.length+plan.recoveryAuthorizedNames.length,'prior-reservation-set-invalid');
 for(const row of plan.priorUploadReservations)need([...plan.reuseOnlyNames,...plan.recoveryAuthorizedNames].includes(row.name)&&/^[a-f0-9]{64}$/.test(row.sha256||'')&&row.file===`github-upload-${row.name}.attempt.json`,'prior-reservation-invalid');
 need(new Set(plan.priorUploadReservations.map(row=>row.name)).size===plan.priorUploadReservations.length,'prior-reservation-duplicate');
 if(plan.recoveryAuthorizedNames.length)need(plan.recoveryAuthorization?.generation===3&&plan.recoveryAuthorization.authorizedBy==='/root'&&/^[a-f0-9]{64}$/.test(plan.recoveryAuthorization.authorizationSha256||'')&&/^[a-f0-9]{64}$/.test(plan.recoveryAuthorization.postExitGetEvidenceSha256||''),'explicit-recovery-authorization-missing');else need(plan.recoveryAuthorization===null,'unexpected-recovery-authorization');
 need(plan.fastOriginalCloud?.originalRunId===37419799452&&plan.fastOriginalCloud.originalHead==='d4ec0b348e5d7c2710394c695adf745202d94763'&&['originalLogSha256','originalEvidenceSha256','originalCandidateFileSha256','originalRunnerSha256'].every(key=>/^[a-f0-9]{64}$/.test(plan.fastOriginalCloud[key]??'')),'original-cloud-proof-missing');
 return plan;
}

export function validateScope(env,{version=process.version,platform=process.platform}={}){
 need(env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','tls-verification-disabled');
 need(version==='v24.19.0'&&platform==='linux'&&env.GITHUB_ACTIONS==='true'&&env.GITHUB_REPOSITORY===REPOSITORY&&env.GITHUB_REF===`refs/heads/${BRANCH}`&&env.GITHUB_EVENT_NAME==='push'&&env.GITHUB_RUN_ATTEMPT==='1'&&/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&/^\d+$/.test(env.GITHUB_RUN_ID||''),'runner-scope-mismatch');
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
 const uploadAttemptedNames=[];
 const readJson=async response=>{need(response.status===200&&response.body,'api-read-failed');const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;need(size<=2*1024*1024,'api-response-too-large');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks));};
 const api=async endpoint=>{
  need(endpoint==='/actions/runs/37419799452'||endpoint===`/releases/${plan.releaseId}`||endpoint==='/releases/latest'||endpoint===`/releases/${plan.releaseId}/assets?per_page=100`||/^\/releases\/assets\/[1-9][0-9]*$/.test(endpoint)||endpoint===`/git/matching-refs/tags/${TAG}`||/^\/git\/tags\/[a-f0-9]{40}$/.test(endpoint),'api-path-rejected');
  return readJson(await fetchImpl(API+endpoint,{headers:auth(),redirect:'error',signal:signal(60000)}));
 };
 const verifyTag=async()=>{
  const refs=await api(`/git/matching-refs/tags/${TAG}`);need(Array.isArray(refs)&&refs.length<100,'tag-list-invalid');
  const found=refs.filter(ref=>ref.ref===`refs/tags/${TAG}`);need(found.length<=1,'duplicate-tag');if(!found.length)return;
  let object=found[0].object;const visited=new Set();
  for(let depth=0;depth<=5;depth++){need(object&&/^[a-f0-9]{40}$/.test(object.sha)&&!visited.has(object.sha),'tag-object-invalid');visited.add(object.sha);if(object.type==='commit'){need(object.sha===SOURCE,'source-tag-mismatch');return;}need(object.type==='tag','tag-object-invalid');object=(await api(`/git/tags/${object.sha}`)).object;}
  throw new TransferError('tag-depth-exceeded');
 };
 const checkDraft=async()=>{
  const original=await api('/actions/runs/37419799452');need(original.id===37419799452&&original.head_sha===plan.fastOriginalCloud.originalHead&&original.head_branch==='release-transfer-v0.9.10'&&original.event==='push'&&original.run_attempt===1&&original.status==='completed'&&['failure','cancelled'].includes(original.conclusion),'original-cloud-still-active-or-changed');
  await verifyTag();const release=await api(`/releases/${plan.releaseId}`),latest=await api('/releases/latest');
  need(release.id===plan.releaseId&&release.draft===true&&release.prerelease===false&&release.tag_name===TAG&&release.target_commitish===SOURCE&&release.url===`${API}/releases/${plan.releaseId}`,'draft-identity-changed');
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
  need(PACKAGE_NAMES.includes(target.name),'mirror-target-rejected');const priorTimeout=getDefaultAutoSelectFamilyAttemptTimeout(),priorOrder=getDefaultResultOrder();
  try{setDefaultAutoSelectFamilyAttemptTimeout(5000);setDefaultResultOrder('ipv4first');return(await downloadRanges(target,directory,{fetchImpl,connections:8,deadline:Math.min(deadline,now()+32*60000),now,log})).file;}
  finally{setDefaultAutoSelectFamilyAttemptTimeout(priorTimeout);setDefaultResultOrder(priorOrder);}
 };
 const readback=async(asset,target,directory)=>{
  need(Number.isSafeInteger(asset.id)&&asset.id>0&&exact(await api(`/releases/assets/${asset.id}`),target),'source-metadata-mismatch');
  const readbackSignal=signal(10*60000),visited=new Set();let response=await fetchImpl(`${API}/releases/assets/${asset.id}`,{headers:{...auth(),Accept:'application/octet-stream','Accept-Encoding':'identity'},redirect:'manual',signal:readbackSignal});
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
 const uploadOrReuse=async(file,target,directory)=>{
  const existing=await currentTarget(target);
  need(!plan.recoveryAuthorizedNames.includes(target.name)||!existing||existing.state==='uploaded'&&exact(existing,target),'recovery-target-pending-or-mismatched');
  if(existing){const asset=existing.state==='uploaded'?(need(exact(existing,target),'existing-target-will-not-be-replaced'),existing):await settle(target);log('existing-upload-reused',{name:target.name,id:asset.id});return readback(asset,target,directory);}
  need(!plan.reuseOnlyNames.includes(target.name),'prior-upload-outcome-unresolved-no-post');
  // Reserve the only permitted POST before calling GitHub. Never retry an uncertain upload.
  const journal=await open(path.join(directory,'upload-attempt.json'),'wx',0o600);try{await journal.writeFile(JSON.stringify({name:target.name,size:target.size,sha256:target.sha256,releaseId:plan.releaseId,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,attemptGeneration:plan.recoveryAuthorizedNames.includes(target.name)?3:1,originalAttemptSha256:plan.priorUploadReservations.find(row=>row.name===target.name)?.sha256??null,recoveryAuthorizationSha256:plan.recoveryAuthorization?.authorizationSha256??null,uploadInvocations:1,noAutomaticRetry:true}));await journal.sync();}finally{await journal.close();}
  need(!await currentTarget(target),'target-created-before-upload');
  log('upload-attempt-reserved',{name:target.name,bytes:target.size,sha256:target.sha256,releaseId:plan.releaseId,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,attemptGeneration:plan.recoveryAuthorizedNames.includes(target.name)?3:1,originalAttemptSha256:plan.priorUploadReservations.find(row=>row.name===target.name)?.sha256??null,recoveryAuthorizationSha256:plan.recoveryAuthorization?.authorizationSha256??null,uploadInvocations:1,noAutomaticRetry:true});
  uploadAttemptedNames.push(target.name);
  try{const response=await fetchImpl(`https://uploads.github.com/repos/${REPOSITORY}/releases/${plan.releaseId}/assets?name=${encodeURIComponent(target.name)}`,{method:'POST',headers:{...auth(),'Content-Type':'application/octet-stream','Content-Length':String(target.size)},body:createReadStream(file),duplex:'half',redirect:'error',signal:signal(10*60000)});log('upload-response',{name:target.name,httpStatus:response.status});await response.body?.cancel();}
  catch{log('upload-result-uncertain',{name:target.name});}
  return readback(await settle(target),target,directory);
 };
 const inlineMetadata=async(target,directory)=>{need(METADATA_NAMES.includes(target.name),'inline-target-rejected');const bytes=Buffer.from(plan.inlineMetadata[target.name],'base64');need(bytes.length===target.size&&sha256(bytes)===target.sha256,'metadata-inline-bytes-mismatch');const file=path.join(directory,target.name),output=await open(file,'wx',0o600);try{await output.writeFile(bytes);await output.sync();}finally{await output.close();}need(sha256(await readFile(file))===target.sha256,'metadata-inline-disk-mismatch');log('inline-metadata-bytes-verified',{name:target.name,bytes:target.size,sha256:target.sha256,installerExecuted:false});return file;};
 return{api,checkDraft,assets,currentTarget,mirror,inlineMetadata,readback,uploadOrReuse,settle,uploadAttemptedNames};
}

export async function transfer(plan,{env=process.env,fetchImpl=fetch,log=(stage,details={})=>console.log(JSON.stringify({stage,...details})),runtime,pause}={}){
 validatePlan(plan);validateScope(env,runtime);need(path.isAbsolute(env.RUNNER_TEMP||''),'runner-directory-invalid');
 const token=env.GH_TOKEN;delete env.GH_TOKEN;
 const client=createClient(plan,{token,fetchImpl,log,pause}),work=path.join(env.RUNNER_TEMP,`petpal-0910-fast-mirror-${env.GITHUB_RUN_ID}`);await mkdir(work,{mode:0o700});
 log('runner-scope-verified',{repository:REPOSITORY,tag:TAG,sourceRevision:SOURCE,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,releaseId:plan.releaseId,headSha:env.GITHUB_SHA,branch:BRANCH,runId:Number(env.GITHUB_RUN_ID),runAttempt:1,fastOriginalCloud:plan.fastOriginalCloud});
 await client.checkDraft();const verified=[];
 for(const [position,name]of plan.targets.entries()){
  const target=plan.assets.find(asset=>asset.name===name),directory=path.join(work,`target-${position}`);await mkdir(directory,{mode:0o700});
  const existing=await client.currentTarget(target);if(existing?.state==='uploaded')need(exact(existing,target),'existing-target-will-not-be-replaced');
  need(!plan.recoveryAuthorizedNames.includes(name)||!existing||existing.state==='uploaded'&&exact(existing,target),'recovery-target-pending-or-mismatched');
  need(!plan.reuseOnlyNames.includes(name)||existing?.state==='uploaded'&&exact(existing,target),'prior-upload-outcome-unresolved-no-post');
  const file=PACKAGE_NAMES.includes(name)?await client.mirror(target,directory):await client.inlineMetadata(target,directory),asset=await client.uploadOrReuse(file,target,directory);verified.push({id:asset.id,...target});
 }
 await client.checkDraft();const final=await client.assets();
 need(final.length===plan.assets.length&&plan.assets.every(target=>exact(final.find(asset=>asset.name===target.name),target)),'complete-asset-set-mismatch');
 log('all-targets-verified',{targets:verified,contractHash:CONTRACT_HASH,planHash:PLAN_HASH,reuseOnlyNames:plan.reuseOnlyNames,recoveryAuthorizedNames:plan.recoveryAuthorizedNames,draft:true,published:false,installerExecuted:false,metadataHandledByThisRunner:true,metadataUploadAttemptedNames:client.uploadAttemptedNames.filter(name=>METADATA_NAMES.includes(name))});return verified;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{need(PINNED,'frozen-plan-not-generated');const recipe=JSON.parse(await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'plan.json'),'utf8'));need(JSON.stringify(recipe)===JSON.stringify(PINNED),'runner-recipe-bytes-mismatch');await transfer(PINNED);}
 catch(error){console.error(JSON.stringify({stage:'failed',code:error instanceof TransferError||error instanceof RangeDownloadError?error.message:'unexpected-error',installerExecuted:false,published:false}));process.exitCode=1;}
}
