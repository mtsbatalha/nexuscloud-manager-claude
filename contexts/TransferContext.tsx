import React, { createContext, useContext, useState, useRef, ReactNode } from 'react';
import { FileItem, Connection } from '../types';

export interface TransferInfo {
  id: string;
  fileName: string;
  fileSize: number;
  srcInfo: string;
  dstInfo: string;
  srcConnId: string;
  srcPath: string;
  dstConnId: string;
  dstPath: string;
  actionType: 'move' | 'copy';
  progress: number;
  status: string;
  failed: boolean;
  startTime: number;
}

interface TransferContextType {
  transfers: TransferInfo[];
  addTransfer: (transfer: Omit<TransferInfo, 'id' | 'progress' | 'failed' | 'startTime'>) => string;
  updateTransferProgress: (id: string, progress: number) => void;
  setTransferStatus: (id: string, status: string) => void;
  setTransferFailed: (id: string, error: string) => void;
  completeTransfer: (id: string) => void;
  removeTransfer: (id: string) => void;
  retryTransfer: (id: string, callback: () => void) => void;
  onNavigate: ((connId: string, path: string) => void) | null;
  setOnNavigate: (callback: (connId: string, path: string) => void) => void;
}

const TransferContext = createContext<TransferContextType | null>(null);

export const useTransfer = () => {
  const context = useContext(TransferContext);
  if (!context) throw new Error('useTransfer must be used within TransferProvider');
  return context;
};

export const TransferProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [transfers, setTransfers] = useState<TransferInfo[]>([]);
  const [onNavigate, setOnNavigateState] = useState<((connId: string, path: string) => void) | null>(null);
  const retryCallbacks = useRef<Map<string, () => void>>(new Map());

  const setOnNavigate = (callback: (connId: string, path: string) => void) => {
    setOnNavigateState(() => callback);
  };

  const addTransfer = (transfer: Omit<TransferInfo, 'id' | 'progress' | 'failed' | 'startTime'>): string => {
    const id = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newTransfer: TransferInfo = {
      ...transfer,
      id,
      progress: 0,
      failed: false,
      startTime: Date.now()
    };
    setTransfers(prev => [...prev, newTransfer]);
    return id;
  };

  const updateTransferProgress = (id: string, progress: number) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, progress } : t));
  };

  const setTransferStatus = (id: string, status: string) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, status } : t));
  };

  const setTransferFailed = (id: string, error: string) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, failed: true, status: error } : t));
  };

  const completeTransfer = (id: string) => {
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, progress: 100, status: 'Concluído!' } : t));
    // Auto-remove after delay
    setTimeout(() => {
      setTransfers(prev => prev.filter(t => t.id !== id));
      retryCallbacks.current.delete(id);
    }, 2000);
  };

  const removeTransfer = (id: string) => {
    setTransfers(prev => prev.filter(t => t.id !== id));
    retryCallbacks.current.delete(id);
  };

  const retryTransfer = (id: string, callback: () => void) => {
    retryCallbacks.current.set(id, callback);
    const existingCallback = retryCallbacks.current.get(id);
    if (existingCallback) {
      removeTransfer(id);
      existingCallback();
    }
  };

  return (
    <TransferContext.Provider value={{
      transfers,
      addTransfer,
      updateTransferProgress,
      setTransferStatus,
      setTransferFailed,
      completeTransfer,
      removeTransfer,
      retryTransfer,
      onNavigate,
      setOnNavigate
    }}>
      {children}
    </TransferContext.Provider>
  );
};
