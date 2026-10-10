import { createContext, useContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export type LibraryViewState = { products: { query: string; status: string; cursor: string | null }; documents: { query: string; status: string; slot: string; cursor: string | null } };
export const initialLibraryView = (): LibraryViewState => ({ products: { query: '', status: 'draft', cursor: null }, documents: { query: '', status: 'active', slot: '', cursor: null } });
export const LibraryViewContext = createContext<{ view: LibraryViewState; setView: Dispatch<SetStateAction<LibraryViewState>> } | null>(null);
export function useLibraryView() { const value = useContext(LibraryViewContext); if (!value) throw new Error('Library view context is missing'); return value; }
