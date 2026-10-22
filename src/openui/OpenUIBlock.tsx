import { Component, useMemo, useRef, useState, type ReactNode } from 'react';
import { Renderer } from '@openuidev/react-lang';
import { openUILibrary } from './library.mjs';
import { copyBoundedData, validateOpenUI } from './validate.mjs';
import { openUIActionText } from './protocol.mjs';
import MessageMarkdown from '../MessageMarkdown';

type Props = { source: string; streaming: boolean; complete: boolean; onUseInPrompt?: (text: string) => void };
function Original({source}: {source: string}) { return <div className="openui-original"><p className="openui-notice" role="status">交互内容暂时无法显示，已保留原文。</p><MessageMarkdown content={'```openui\n' + source + '\n```'}/></div>; }
class Boundary extends Component<{children: ReactNode; source: string}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Original source={this.props.source}/> : this.props.children; }
}

export default function OpenUIBlock(props: Props) {
  const {source, streaming, complete} = props;
  const validation = useMemo(() => validateOpenUI(source, {streaming}), [source, streaming]);
  const lastValid = useRef<string | null>(null), initialState = useRef({}), latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState(false);
  if (validation.valid) lastValid.current = source;
  const visibleSource = validation.valid ? source : streaming ? lastValid.current : null;
  if (failed || !streaming && !validation.valid) return <Original source={source}/>;
  if (visibleSource === null) return <div className="openui-loading" role="status">正在生成交互界面…</div>;
  return <Boundary source={source}><fieldset className="openui-renderer" disabled={!streaming && !complete} aria-label="交互回复" aria-busy={streaming}>
    <Renderer response={visibleSource} library={openUILibrary} isStreaming={streaming} initialState={initialState.current} publishObservability={false}
      onStateUpdate={value => { try { copyBoundedData(value); } catch { setFailed(true); } }}
      onAction={event => { if (!latest.current.complete || latest.current.streaming) return; const text = openUIActionText(event); if (text) latest.current.onUseInPrompt?.(text); }}
      onError={errors => { if (!latest.current.streaming && errors.length) setFailed(true); }}/>
  </fieldset></Boundary>;
}
