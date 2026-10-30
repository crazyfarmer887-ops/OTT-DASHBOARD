import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
type Node = DefaultTreeAdapterMap['node'];
const all = (n: Node): Node[] => [n,...('childNodes' in n?n.childNodes.flatMap(all):[])];
const text = (n: Node): string => (n.nodeName==='#text'&&'value' in n?n.value:'')+('childNodes' in n?n.childNodes.map(text).join(''):'');
/** The seller list omits keepMemo; verify its saved private form instead. */
export function savedGraytagKeepMemo(html: string): string {
  const nodes=all(parseFragment(html)).filter(n=>n.nodeName==='textarea'&&'attrs' in n&&n.attrs.some(a=>a.name==='id'&&a.value==='keepMemo'));
  if(nodes.length!==1)throw Error('KEEP_MEMO_UNVERIFIED');
  return text(nodes[0]);
}
