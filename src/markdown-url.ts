/** Links are user initiated; reject active schemes and ambiguous controls. */
export function safeMarkdownUrl(value:string):string {
  if (/[\u0000-\u0020\u007f]/u.test(value)) return '';
  try {
    const url=new URL(value,'https://petpal.invalid');
    return ['http:','https:','mailto:'].includes(url.protocol)?value:'';
  } catch { return ''; }
}
