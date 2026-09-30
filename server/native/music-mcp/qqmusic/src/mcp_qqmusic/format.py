"""响应格式化 - 紧凑文本输出，节省 LLM 上下文."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any


def _strip_html(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"<[^>]+>", "", str(text))


def _singer_names(singers: list[Any] | None) -> str:
    if not singers:
        return "未知"
    return "/".join(getattr(s, "name", str(s)) or "未知" for s in singers)


def _singer_detail(singers: list[Any] | None) -> str:
    """歌手名 + ID/MID，用于搜索结果和详情."""
    if not singers:
        return "未知"
    parts = []
    for s in singers:
        name = getattr(s, "name", str(s)) or "未知"
        sid = getattr(s, "id", None)
        mid = getattr(s, "mid", None)
        tag = name
        if sid or mid:
            tag += f" (ID:{sid} MID:{mid})"
        parts.append(tag)
    return "/".join(parts)


def _duration(seconds: int | float | None) -> str:
    if not seconds:
        return ""
    m, s = divmod(int(seconds), 60)
    return f"{m}:{s:02d}"


def _vip_tag(song: Any) -> str:
    """检测 VIP 标记."""
    pay = getattr(song, "pay", None)
    if pay and getattr(pay, "pay_play", 0):
        return "[VIP]"
    return ""


def _song_line(song: Any, idx: int | None = None) -> str:
    """搜索/列表中的单行歌曲信息."""
    name = _strip_html(getattr(song, "name", None) or getattr(song, "title", None)) or "未知"
    singer = _singer_names(getattr(song, "singer", None))
    album = _strip_html(getattr(getattr(song, "album", None), "name", None)) or "未知"
    dur = _duration(getattr(song, "interval", None))
    sid = getattr(song, "id", None) or ""
    mid = getattr(song, "mid", None) or ""
    vip = _vip_tag(song)
    mv = getattr(song, "mv", None)
    mv_vid = getattr(mv, "vid", None) if mv else ""
    prefix = f"{idx}. " if idx else ""
    parts = [f"{prefix}{vip}{name}" if vip else f"{prefix}{name}"]
    parts.append(singer)
    parts.append(album)
    if dur:
        parts.append(dur)
    parts.append(f"ID:{sid} MID:{mid}")
    if mv_vid:
        parts.append(f"MV:{mv_vid}")
    return " | ".join(parts)


def fmt_songs(songs: list[Any]) -> str:
    if not songs:
        return "无结果"
    return "\n".join(_song_line(s, i + 1) for i, s in enumerate(songs))


def fmt_singers(singers: list[Any]) -> str:
    """歌手搜索结果格式化."""
    if not singers:
        return "无结果"
    lines = []
    for i, s in enumerate(singers):
        name = getattr(s, "name", None) or getattr(s, "title", "未知")
        mid = getattr(s, "mid", None) or ""
        lines.append(f"{i+1}. {name} | MID:{mid}")
    return "\n".join(lines)


def fmt_albums(albums: list[Any]) -> str:
    """专辑搜索结果格式化."""
    if not albums:
        return "无结果"
    lines = []
    for i, a in enumerate(albums):
        name = _strip_html(getattr(a, "name", None) or getattr(a, "title", None)) or "未知"
        mid = getattr(a, "mid", None) or ""
        singer = getattr(a, "singer", None)
        singer_str = singer if isinstance(singer, str) else ""
        pub = getattr(a, "time_public", None) or ""
        parts = [f"{i+1}. {name}"]
        if singer_str:
            parts.append(singer_str)
        parts.append(f"MID:{mid}")
        if pub:
            parts.append(f"发行:{pub}")
        lines.append(" | ".join(parts))
    return "\n".join(lines)


def fmt_mv_list(mvs: list[Any]) -> str:
    """MV搜索结果格式化."""
    if not mvs:
        return "无结果"
    lines = []
    for i, m in enumerate(mvs):
        name = _strip_html(getattr(m, "name", None) or getattr(m, "title", None)) or "未知"
        vid = getattr(m, "vid", None) or ""
        dur = _duration(getattr(m, "duration", None))
        parts = [f"{i+1}. {name}"]
        if dur:
            parts.append(dur)
        parts.append(f"VID:{vid}")
        lines.append(" | ".join(parts))
    return "\n".join(lines)


def fmt_songlists(songlists: list[Any]) -> str:
    """歌单搜索结果格式化."""
    if not songlists:
        return "无结果"
    lines = []
    for i, s in enumerate(songlists):
        title = _strip_html(getattr(s, "title", None) or getattr(s, "name", None)) or "未知"
        sid = getattr(s, "id", None) or ""
        num = getattr(s, "songnum", None) or ""
        listen = getattr(s, "listennum", None) or ""
        nick = getattr(s, "nickname", None) or ""
        parts = [f"{i+1}. {title}"]
        if nick:
            parts.append(nick)
        if num:
            parts.append(f"{num}首")
        parts.append(f"ID:{sid}")
        if listen:
            parts.append(f"播放:{listen}")
        lines.append(" | ".join(parts))
    return "\n".join(lines)


def fmt_song_detail(track: Any) -> str:
    if not track:
        return "未找到歌曲"
    name = getattr(track, "name", None) or getattr(track, "title", "未知")
    sid = getattr(track, "id", "未知")
    mid = getattr(track, "mid", "未知")
    singer = getattr(track, "singer", None)
    album = getattr(track, "album", None)
    album_name = getattr(album, "name", None) or "未知"
    album_mid = getattr(album, "mid", None) or ""
    album_id = getattr(album, "id", None) or ""
    interval = getattr(track, "interval", None)
    pub = getattr(album, "time_public", None) or getattr(track, "time_public", None)
    vip = _vip_tag(track)
    lang = getattr(track, "language", None)
    bpm = getattr(track, "bpm", None)
    lines = [
        f"歌曲: {name}{vip}",
        f"ID: {sid}",
        f"MID: {mid}",
        f"歌手: {_singer_detail(singer)}",
        f"专辑: {album_name} (ID:{album_id} MID:{album_mid})",
    ]
    if interval:
        lines.append(f"时长: {_duration(interval)}")
    if pub:
        lines.append(f"发行: {pub}")
    if lang is not None:
        lines.append(f"语言: {lang}")
    if bpm:
        lines.append(f"BPM: {bpm}")
    mv = getattr(track, "mv", None)
    mv_vid = getattr(mv, "vid", None) if mv else ""
    if mv_vid:
        lines.append(f"MV: {mv_vid}")
    return "\n".join(lines)


def fmt_album_detail(detail: Any, songs: list[Any] | None = None) -> str:
    if not detail:
        return "未找到专辑"
    album = getattr(detail, "album", detail)
    album_name = getattr(album, "name", "未知")
    album_mid = getattr(album, "mid", "未知")
    album_id = getattr(album, "id", "未知")
    lines = [
        f"专辑: {album_name}",
        f"ID: {album_id}",
        f"MID: {album_mid}",
        f"歌手: {_singer_detail(getattr(detail, 'singer', None) or getattr(album, 'singer', None))}",
    ]
    pub = getattr(album, "time_public", None) or getattr(detail, "pub_time", None)
    if pub:
        lines.append(f"发行: {pub}")
    total = getattr(album, "total", None) or getattr(detail, "total", None)
    if total:
        lines.append(f"曲目数: {total}")
    lang = getattr(album, "language", None)
    if lang:
        lines.append(f"语言: {lang}")
    genre = getattr(album, "genre", None)
    if genre:
        lines.append(f"流派: {genre}")
    desc = getattr(detail, "desc", None) or getattr(album, "desc", None)
    if desc:
        lines.append(f"简介: {desc[:300]}")
    if songs:
        lines += ["", "--- 歌曲列表 ---", fmt_songs(songs)]
    return "\n".join(lines)


def fmt_singer_info(info: Any, desc: Any = None, songs: list[Any] | None = None,
                    albums: list[Any] | None = None, wiki: str = "") -> str:
    if not info:
        return "未找到歌手"
    singer = getattr(info, "singer", info)
    sid = getattr(singer, "id", "未知")
    mid = getattr(singer, "mid", "未知")
    lines = [
        f"歌手: {getattr(singer, 'name', '未知')}",
        f"ID: {sid}",
        f"MID: {mid}",
    ]
    # base_info may be HomepageBaseInfo with name/avatar
    base = getattr(info, "base_info", None)
    if base:
        bname = getattr(base, "name", None)
        if bname:
            lines.append(f"昵称: {bname}")
    # desc: singer_list[0].ex_info or singer_desc list
    ex = None
    if desc:
        sl = getattr(desc, "singer_list", None)
        if sl and len(sl) > 0:
            ex = getattr(sl[0], "ex_info", None)
        if not ex:
            items = getattr(desc, "singer_desc", None) or (desc if isinstance(desc, list) else None)
            if items and len(items) > 0:
                ex = items[0]
    if ex:
        extras = []
        for field, label in [("area", "地区"), ("genre", "流派"), ("birthday", "生日"),
                              ("instrument", "擅长乐器"), ("company", "唱片公司"),
                              ("identity", "身份"), ("tag", "标签"), ("foreign_name", "外文名"),
                              ("enter", "出道时间")]:
            val = getattr(ex, field, None)
            if val:
                extras.append(f"{label}: {val}")
        if extras:
            lines += extras
    if wiki:
        lines += ["", "--- 简介 ---", wiki]
    if songs:
        lines += ["", "--- 热门歌曲 ---", fmt_songs(songs)]
    if albums:
        lines += ["", "--- 专辑 ---"]
        for i, a in enumerate(albums):
            aname = getattr(a, "name", None) or getattr(a, "title", "未知")
            aid = getattr(a, "id", None) or ""
            amid = getattr(a, "mid", None) or ""
            apub = getattr(a, "time_public", None) or ""
            lines.append(f"{i+1}. {aname} | ID:{aid} MID:{amid}{f' | 发行:{apub}' if apub else ''}")
    return "\n".join(lines)


def fmt_songlist_detail(detail: Any) -> str:
    if not detail:
        return "未找到歌单"
    info = getattr(detail, "info", None) or detail
    title = (getattr(info, "title", None) or getattr(info, "dirname", None)
             or getattr(info, "dissname", None) or "未知")
    tid = getattr(info, "id", None) or getattr(info, "dirid", None) or "未知"
    lines = [
        f"歌单: {title}",
        f"ID: {tid}",
    ]
    num = getattr(info, "songnum", None) or getattr(detail, "total", None)
    if num:
        lines.append(f"歌曲数: {num}")
    listennum = getattr(info, "listennum", None)
    if listennum:
        lines.append(f"播放量: {listennum}")
    creator = getattr(info, "creator", None)
    if creator:
        cname = getattr(creator, "name", None) or getattr(creator, "nickname", None)
        if cname:
            lines.append(f"创建者: {cname}")
    tag = getattr(info, "tag", None)
    if tag:
        tags = getattr(tag, "tag_list", None) or (tag if isinstance(tag, list) else None)
        if tags:
            tag_names = []
            for t in tags:
                tn = getattr(t, "name", None) or getattr(t, "tag_name", None)
                if tn:
                    tag_names.append(tn)
            if tag_names:
                lines.append(f"标签: {'/'.join(tag_names)}")
    desc = getattr(info, "desc", None)
    if desc:
        lines.append(f"简介: {desc[:300]}")
    songs = getattr(detail, "songs", None) or getattr(detail, "songlist", None)
    if songs:
        lines += ["", "--- 歌曲列表 ---", fmt_songs(songs)]
    return "\n".join(lines)


def fmt_top_detail(detail: Any) -> str:
    if not detail:
        return "未找到排行榜"
    info = getattr(detail, "info", None) or detail
    name = (getattr(info, "name", None) or getattr(info, "title", None)
            or getattr(detail, "title", None) or "未知")
    lines = [f"排行榜: {name}"]
    period = getattr(info, "period", None) or getattr(detail, "update", None)
    if period:
        lines.append(f"更新: {period}")
    listen = getattr(info, "listen_num", None) or getattr(detail, "listenNum", None)
    if listen:
        lines.append(f"播放量: {listen}")
    total = getattr(info, "total_num", None)
    if total:
        lines.append(f"歌曲数: {total}")
    intro = getattr(info, "intro", None)
    if intro:
        lines.append(f"简介: {intro[:300]}")
    songs = getattr(detail, "songs", None) or getattr(info, "songs", None) or getattr(detail, "song", None)
    if songs:
        lines += ["", "--- 歌曲列表 ---", fmt_songs(songs)]
    return "\n".join(lines)


def fmt_top_category(cats: Any) -> str:
    if not cats:
        return "无数据"
    if isinstance(cats, list):
        lines = []
        for g in cats:
            items = getattr(g, "toplist", None) or (g if isinstance(g, list) else [g])
            for t in items:
                tid = getattr(t, "topId", None) or getattr(t, "id", "?")
                title = getattr(t, "title", None) or getattr(t, "label", "未知")
                lines.append(f"{tid}: {title}")
        return "\n".join(lines)
    return str(cats)[:500]


def fmt_lyric(data: Any) -> str:
    if not data:
        return "未找到歌词"
    raw = getattr(data, "lyric", "") or ""
    if not raw:
        return "无歌词"

    def _strip_ts(text: str) -> str:
        lines = []
        for line in text.split("\n"):
            parts = line.split("]", 1)
            lines.append(parts[-1].strip() if len(parts) > 1 else line.strip())
        return "\n".join(l for l in lines if l)

    parts = [_strip_ts(raw)]
    trans = getattr(data, "trans", None)
    if trans:
        t = _strip_ts(trans)
        if t:
            parts += ["", "--- 翻译 ---", t]
    roma = getattr(data, "roma", None)
    if roma:
        r = _strip_ts(roma)
        if r:
            parts += ["", "--- 罗马音 ---", r]
    return "\n".join(parts)


def fmt_song_urls(data: Any) -> str:
    if not data:
        return "未获取到播放链接"
    items = getattr(data, "data", None) or (data if isinstance(data, list) else [data])
    if not items:
        return "未获取到播放链接"
    lines = []
    for item in items:
        purl = getattr(item, "purl", None)
        mid = getattr(item, "mid", "未知")
        if not purl:
            lines.append(f"{mid}: 无法获取链接 (可能需要VIP)")
            continue
        url = purl if purl.startswith("http") else f"https://dl.stream.qqmusic.qq.com/{purl}"
        vkey = getattr(item, "vkey", None)
        if vkey:
            url = f"{url}?vkey={vkey}"
        lines.append(url)
    return "\n".join(lines)


def fmt_recommend(data: Any, rtype: str) -> str:
    if not data:
        return "无推荐数据"
    if rtype == "song":
        songs = getattr(data, "songs", None)
        if songs:
            return fmt_songs(songs)
    if rtype == "songlist":
        items = getattr(data, "songlists", None)
        if items:
            lines = []
            for i, s in enumerate(items):
                title = _strip_html(getattr(s, "title", None) or getattr(s, "dissname", "")) or "未知"
                creator = (getattr(getattr(s, "creator", None), "name", None)
                          or getattr(s, "creator_nick", None) or getattr(s, "nickname", ""))
                num = getattr(s, "songnum", None) or getattr(s, "total", "")
                tid = getattr(s, "id", None) or getattr(s, "tid", "") or ""
                listen = getattr(s, "listennum", None) or ""
                lines.append(f"{i+1}. {title} | {creator}{f' | {num}首' if num else ''} | ID:{tid}{f' | 播放:{listen}' if listen else ''}")
            return "\n".join(lines)
    return str(data)[:500]


def fmt_hotkeys(data: Any) -> str:
    """热搜榜格式化."""
    if not data:
        return "无数据"
    items = []
    if isinstance(data, dict):
        items = data.get("vec_hotkey", [])
    if not items:
        return "无热搜数据"
    lines = []
    for i, item in enumerate(items):
        if isinstance(item, dict):
            word = item.get("title", "") or item.get("query", "")
            score = item.get("score", "")
        else:
            word = getattr(item, "title", None) or getattr(item, "query", "")
            score = getattr(item, "score", None) or ""
        if not word:
            continue
        part = f"{i+1}. {word}"
        if score:
            part += f" (热度:{score})"
        lines.append(part)
    return "\n".join(lines) if lines else "无热搜数据"


def fmt_complete(data: Any) -> str:
    """搜索联想格式化."""
    if not data:
        return "无联想结果"
    if isinstance(data, dict):
        items = data.get("items", []) or data.get("vec_direct_items", [])
    else:
        items = getattr(data, "items", None) or []
    if not items:
        return "无联想结果"
    lines = []
    for i, item in enumerate(items):
        if isinstance(item, dict):
            word = item.get("hint", "") or item.get("title", "")
        else:
            word = getattr(item, "hint", None) or getattr(item, "title", "")
        if word:
            # 去除 HTML 高亮标签
            word = _strip_html(word)
            lines.append(f"{i+1}. {word}")
    return "\n".join(lines) if lines else "无联想结果"


def fmt_similar_singers(singers: list[Any]) -> str:
    """相似歌手格式化."""
    if not singers:
        return "无相似歌手"
    lines = []
    for i, s in enumerate(singers):
        name = getattr(s, "name", None) or getattr(s, "singer_name", None) or "未知"
        mid = getattr(s, "mid", None) or getattr(s, "singer_mid", None) or ""
        lines.append(f"{i+1}. {name} | MID:{mid}")
    return "\n".join(lines)


def fmt_producer(data: Any) -> str:
    """歌曲制作信息格式化."""
    if not data:
        return "无制作信息"
    groups = getattr(data, "data", None) or []
    if groups is None:
        groups = []
    if not groups:
        return "无制作信息"
    lines = []
    for group in groups:
        title = getattr(group, "title", "") or "未知角色"
        producers = getattr(group, "producers", None) or []
        names = []
        for p in producers:
            name = getattr(p, "name", "") or ""
            singer_mid = getattr(p, "singer_mid", "") or ""
            if name:
                tag = name
                if singer_mid:
                    tag += f" (MID:{singer_mid})"
                names.append(tag)
        if names:
            lines.append(f"{title}: {' / '.join(names)}")
    return "\n".join(lines) if lines else "无制作信息"


def fmt_comments(comments: list[Any]) -> str:
    """热门评论格式化."""
    if not comments:
        return "无评论"
    lines = []
    for i, c in enumerate(comments):
        nick = getattr(c, "nick", "") or "匿名"
        content = getattr(c, "content", "") or ""
        praise = getattr(c, "praise_num", 0)
        reply = getattr(c, "reply_cnt", 0)
        pub_time = getattr(c, "pub_time", 0)
        time_str = ""
        if pub_time:
            try:
                time_str = datetime.fromtimestamp(pub_time).strftime("%Y-%m-%d")
            except (ValueError, OSError, TypeError):
                time_str = str(pub_time)
        part = f"{i+1}. [{nick}]"
        if time_str:
            part += f" ({time_str})"
        part += f"\n   {content}"
        stats = []
        if praise:
            stats.append(f"👍{praise}")
        if reply:
            stats.append(f"💬{reply}")
        if stats:
            part += f"\n   {' '.join(stats)}"
        lines.append(part)
    return "\n".join(lines)


def fmt_mv_detail(detail: Any, urls: Any = None) -> str:
    if not detail:
        return "未找到MV"
    data = getattr(detail, "data", detail)
    # data is dict[vid, MvDetail] or MvDetail directly
    if isinstance(data, dict):
        mv = next(iter(data.values()), None) if data else None
    else:
        mv = data
    if not mv:
        return "未找到MV"
    name = getattr(mv, "name", None) or getattr(mv, "title", "未知")
    vid = getattr(mv, "vid", "未知")
    singers = getattr(mv, "singers", None)
    singer_str = "/".join(s.get("name", "未知") for s in singers) if singers else "未知"
    dur = _duration(getattr(mv, "duration", None))
    playcnt = getattr(mv, "playcnt", None)
    pubdate = getattr(mv, "pubdate", None)
    desc = getattr(mv, "desc", None)

    lines = [
        f"MV: {name}",
        f"VID: {vid}",
        f"歌手: {singer_str}",
    ]
    if dur:
        lines.append(f"时长: {dur}")
    if playcnt:
        lines.append(f"播放量: {playcnt}")
    if pubdate:
        try:
            pub_str = datetime.fromtimestamp(pubdate).strftime("%Y-%m-%d")
        except (ValueError, OSError, TypeError):
            pub_str = str(pubdate)
        lines.append(f"发布: {pub_str}")
    if desc:
        lines.append(f"简介: {desc[:300]}")

    # URLs
    if urls:
        url_data = getattr(urls, "data", urls)
        if isinstance(url_data, dict):
            url_set = next(iter(url_data.values()), None) if url_data else None
        else:
            url_set = url_data
        if url_set:
            mp4_list = getattr(url_set, "mp4", None) or []
            for item in mp4_list:
                url_list = getattr(item, "url", None) or []
                if url_list:
                    lines.append(f"播放链接: {url_list[0]}")
                    break
    return "\n".join(lines)
