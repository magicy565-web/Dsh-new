import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { LibraryViewContext } from './viewState';
import type { LibraryViewState } from './viewState';
import { Products } from './Products';
import { CompanyLibrary } from './Company';
import './library.css';
import { Icon } from '../icons';
import { SpaceLibraryTab } from '../space/SpaceLibraryTab';
import { ProductLibrary } from '../product-library/ProductLibrary';

export function BusinessLibrary({ path = '', readOnly, isAdmin, navigate, onDirty, notes, view, setView }: { path?: string; readOnly: boolean; isAdmin: boolean; navigate: (path: string) => void; onDirty: (dirty: boolean) => void; notes: ReactNode; view: LibraryViewState; setView: Dispatch<SetStateAction<LibraryViewState>> }) {
  const route = path.split('/').filter(Boolean);
  const tab = route[0] || 'notes';
  return <LibraryViewContext.Provider value={{ view, setView }}><div className={`business-library ${route.length > 1 ? 'bl-detail-page' : 'bl-list-page'}`}>{route.length <= 1 && <header className="bl-library-title"><div><span className="ys-eyebrow"><i aria-hidden="true"/>企业的知识与底气</span><h1>资料库</h1><p>每一份资料，都为下一步做好准备。</p></div><span className="ys-library-emblem"><Icon name="library" size={32}/></span></header>}<nav className="bl-tabs" aria-label="资料库分类">{[['company', '企业资料'], ['products', '产品库'], ['product-library', '产品资料库'], ['notes', '笔记与记忆'], ['spaces', 'Space 页面']].map(([key, label]) => <button key={key} className={tab === key ? 'selected' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => navigate(key)}>{label}</button>)}</nav>{readOnly && <p className="bl-help" role="status">当前账号仅有读取权限。</p>}{tab === 'spaces' ? <SpaceLibraryTab onDirty={onDirty} /> : tab === 'product-library' ? <ProductLibrary readOnly={readOnly} /> : tab === 'products' ? <Products route={route} readOnly={readOnly} navigate={navigate} onDirty={onDirty} /> : tab === 'company' ? <CompanyLibrary route={route} readOnly={readOnly} isAdmin={isAdmin} navigate={navigate} onDirty={onDirty} /> : notes}</div></LibraryViewContext.Provider>;
}
