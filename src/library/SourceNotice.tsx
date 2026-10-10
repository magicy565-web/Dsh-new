import { Icon } from '../icons';
import type { LibrarySource } from './types';
import { stamp } from './common';

export function SourceNotice({ source, product = false }: { source?: LibrarySource; product?: boolean }) {
  if (source?.kind !== 'public_reference') return null;
  const url = source.sourceUrl?.startsWith('https://') ? source.sourceUrl : null;
  return <section className="bl-source"><strong>{product ? '公开参考产品，非本企业在售' : '公开参考资料，非本企业证明文件'}</strong><div className="bl-source-links">{url && <a href={url} target="_blank" rel="noreferrer noopener">官方来源 <Icon name="external" size={13}/></a>}<details><summary>来源说明与字段出处 ({source.fieldSources.length})</summary><p>用于了解公开产品与规格。企业报价、MOQ、库存和证照尚未确认。</p>{source.fetchedAt && <small>采集于 {stamp(source.fetchedAt)}</small>}{source.fieldSources.map((field, i) => <div key={`${field.fieldPath}/${i}`}><strong>{field.fieldPath}</strong><p>{field.locator}</p><p>{field.capturedValue}</p>{field.sourceUrl.startsWith('https://') && <a href={field.sourceUrl} target="_blank" rel="noreferrer noopener">对应来源 <Icon name="external" size={13}/></a>}</div>)}</details></div></section>;
}
