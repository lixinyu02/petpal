import { useId } from 'react';
export default function Cat({ mood = 'idle', small = false }: { mood?: string; small?: boolean }) {
  const uid = useId().replace(/:/g, '');
  return <svg className={`cat cat-${mood} ${small ? 'cat-small' : ''}`} viewBox="0 0 320 330" role="img" aria-label={mood === 'sleep' ? '正在打盹的小猫' : '奶油色小猫'}>
    <defs><linearGradient id={`fur${uid}`} x1="0" y1="0" x2="0.8" y2="1"><stop stopColor="#f5e6cd"/><stop offset="1" stopColor="#dcc09b"/></linearGradient><linearGradient id={`belly${uid}`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fff9ee"/><stop offset="1" stopColor="#f0dfc6"/></linearGradient></defs>
    <ellipse className="cat-shadow" cx="159" cy="302" rx="95" ry="13" fill="#234a37" opacity=".09"/>
    <g className="cat-body">
      <path className="cat-tail" d="M228 260c49 16 71-16 51-49-9-14-22-9-19 4 8 22-8 21-23 15" fill={`url(#fur${uid})`} stroke="#c7aa85" strokeWidth="2"/>
      <path d="M114 164c-24 34-40 86-26 117 8 21 136 24 145 0 10-27-7-86-33-117" fill={`url(#fur${uid})`} stroke="#bca180" strokeWidth="2.5"/>
      <ellipse cx="160" cy="249" rx="43" ry="46" fill={`url(#belly${uid})`}/>
      <path d="M111 230c-4 18-6 43 0 57m100-57c4 18 6 43 0 57" stroke="#c5a782" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
      <ellipse cx="115" cy="288" rx="24" ry="12" fill="#ecdbbf" stroke="#bca180" strokeWidth="2"/><ellipse cx="206" cy="288" rx="24" ry="12" fill="#ecdbbf" stroke="#bca180" strokeWidth="2"/>
      <path d="M109 291v5m9-5v5m83-5v5m9-5v5" stroke="#bfa585" strokeWidth="2" strokeLinecap="round"/>
      <g className="cat-head">
        <path d="M88 111C73 86 67 38 79 30c12-7 46 24 58 40a108 108 0 0 1 47 0c13-17 45-47 58-40 12 7 6 56-9 82" fill={`url(#fur${uid})`} stroke="#bca180" strokeWidth="2.5"/>
        <path d="m86 48 12 55 26-25zM232 48l-12 55-25-25z" fill="#d9a99c"/><path d="M83 122c1-35 33-59 78-59s76 24 78 59c15 16 20 43 5 62-14 25-50 40-83 40s-72-17-86-40c-14-21-8-47 8-62" fill={`url(#fur${uid})`} stroke="#bca180" strokeWidth="2.5"/>
        <path d="m148 68 5 23m10-24 1 24m13-22-6 22" stroke="#c3a17a" strokeWidth="6" strokeLinecap="round" opacity=".55"/>
        <path d="M82 162c10-1 18 2 22 6m-24 7 22 5m137-18c-10-1-18 2-22 6m24 7-22 5" stroke="#c3a17a" strokeWidth="5" strokeLinecap="round" opacity=".5"/>
        <ellipse cx="116" cy="173" rx="15" ry="8" fill="#d8958b" opacity=".35"/><ellipse cx="204" cy="173" rx="15" ry="8" fill="#d8958b" opacity=".35"/>
        <g className="cat-eyes"><ellipse cx="122" cy="147" rx="7" ry="11" fill="#334c3c"/><ellipse cx="198" cy="147" rx="7" ry="11" fill="#334c3c"/><circle cx="124" cy="143" r="2.4" fill="#fff"/><circle cx="200" cy="143" r="2.4" fill="#fff"/></g>
        <g className="cat-sleep-eyes" stroke="#334c3c" strokeWidth="3" fill="none" strokeLinecap="round"><path d="m112 148 10 4 10-4m56 0 10 4 10-4"/></g>
        <path d="M154 166q6-4 12 0l-6 6z" fill="#a77d6c"/><path d="M160 173v6m0 0c-4 7-11 7-15 2m15-2c4 7 11 7 15 2" fill="none" stroke="#775f50" strokeWidth="2.5" strokeLinecap="round"/>
        <path d="m98 176-29-4m30 12-30 4m152-12 29-4m-30 12 30 4" stroke="#ac947a" strokeWidth="2" strokeLinecap="round"/>
      </g>
      <path d="M123 215q38 15 75 0" fill="none" stroke="#447b60" strokeWidth="8"/>
      <circle cx="160" cy="229" r="10" fill="#d5a75c" stroke="#b68c44" strokeWidth="1.5"/><path d="M156 229h8m-4 1v6" stroke="#8f6d37" strokeWidth="1.8"/>
    </g>
    <g className="cat-hearts" fill="#bd7e77"><path d="M59 96c-14-12-19 6 0 15 19-9 14-27 0-15"/><path d="M270 120c-12-10-17 5 0 13 17-8 12-23 0-13"/></g>
    <g className="cat-zzz" fill="#698775" fontFamily="monospace" fontWeight="bold"><text x="252" y="90" fontSize="25">z</text><text x="271" y="61" fontSize="18">z</text></g>
  </svg>;
}
