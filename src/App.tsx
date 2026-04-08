/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  setDoc, 
  deleteDoc, 
  serverTimestamp, 
  query, 
  where,
  getDocFromServer
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut, 
  User 
} from 'firebase/auth';
import { 
  format, 
  startOfWeek, 
  addDays, 
  isSameDay, 
  parseISO, 
  addWeeks, 
  subWeeks 
} from 'date-fns';
import { ko } from 'date-fns/locale';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  LogOut, 
  User as UserIcon, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  XCircle,
  AlertCircle,
  Loader2,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import { db, auth } from './firebase';
import { ROOMS, TIME_SLOTS, Reservation } from './types';
import { cn } from './lib/utils';

// --- Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: any[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, setError?: (msg: string | null) => void) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  
  if (setError) {
    if (errInfo.error.includes('permission-denied')) {
      setError('권한이 없습니다. 다시 로그인해 주세요.');
    } else if (errInfo.error.includes('offline')) {
      setError('네트워크 연결이 불안정합니다.');
    } else {
      setError(`오류가 발생했습니다: ${errInfo.error}`);
    }
    setTimeout(() => setError(null), 5000);
  }
  
  return errInfo;
}

// --- Components ---

const ErrorBoundary = ({ children }: { children: React.ReactNode }) => {
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (event.message.includes('Firestore Error')) {
        setHasError(true);
        try {
          const parsed = JSON.parse(event.message.replace('Uncaught Error: ', ''));
          setErrorMessage(parsed.error);
        } catch {
          setErrorMessage(event.message);
        }
      }
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-red-50 text-red-900">
        <AlertCircle className="w-12 h-12 mb-4" />
        <h1 className="text-xl font-bold mb-2">문제가 발생했습니다</h1>
        <p className="text-center mb-4">{errorMessage}</p>
        <button 
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          새로고침
        </button>
      </div>
    );
  }

  return <>{children}</>;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [error, setError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Connection Test
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 2;

    const testConnection = async () => {
      try {
        // Use a small timeout for the connection test
        await getDocFromServer(doc(db, 'test', 'connection'));
        console.log("Firestore connection test successful");
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn("Firestore connection test attempt failed:", errorMsg);
        
        if (errorMsg.includes('the client is offline')) {
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(testConnection, 3000);
          } else {
            setError("네트워크 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.");
            setTimeout(() => setError(null), 5000);
          }
        }
        // Ignore permission-denied for the test doc, as it's expected if not defined in rules
      }
    };
    
    // Delay initial test to allow network to stabilize in iframe
    const timer = setTimeout(testConnection, 1000);
    return () => clearTimeout(timer);
  }, []);

  // Real-time Reservations
  useEffect(() => {
    if (!user) return;

    const q = collection(db, 'reservations');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));
      setReservations(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'reservations', setError);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
    }
  };

  const handleLogout = () => signOut(auth);

  const weekDays = useMemo(() => {
    return [0, 1, 2, 3, 4].map(i => addDays(selectedWeekStart, i));
  }, [selectedWeekStart]);

  const handleReservation = async (date: Date, roomId: string, timeSlot: number) => {
    if (!user) return;

    const dateStr = format(date, 'yyyy-MM-dd');
    const reservationId = `${dateStr}_${roomId}_${timeSlot}`;
    
    // Check if already reserved locally (UI safety)
    if (reservations.some(r => r.id === reservationId)) {
      setError('이미 예약된 시간입니다.');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      const reservationData = {
        date: dateStr,
        roomId,
        timeSlot,
        userName: user.displayName || '익명',
        userId: user.uid,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'reservations', reservationId), reservationData);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `reservations/${reservationId}`, setError);
    }
  };

  const handleDelete = async (reservationId: string, ownerId: string) => {
    if (!user || user.uid !== ownerId) return;

    try {
      await deleteDoc(doc(db, 'reservations', reservationId));
      setDeletingId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `reservations/${reservationId}`, setError);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-3xl shadow-xl p-8 text-center border border-slate-100"
        >
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-200">
            <CalendarIcon className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">상담실 예약</h1>
          <p className="text-slate-500 mb-8">구글 계정으로 로그인하여<br/>상담실을 예약하세요.</p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-blue-600 text-white rounded-2xl font-semibold hover:bg-blue-700 transition-all flex items-center justify-center gap-3 shadow-lg shadow-blue-100"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6 bg-white rounded-full p-1" />
            Google로 로그인
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-bottom border-slate-200 px-4 py-3 md:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-md shadow-blue-100">
                <CalendarIcon className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight hidden sm:block">상담실 예약 시스템</h1>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full text-sm font-medium text-slate-700">
                <UserIcon className="w-4 h-4" />
                <span>{user.displayName}</span>
              </div>
              <button 
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                title="로그아웃"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto p-4 md:p-8">
          {/* Error Toast */}
          <AnimatePresence>
            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 50 }}
                className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5" />
                <span className="font-medium">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setSelectedWeekStart(subWeeks(selectedWeekStart, 1))}
                className="p-2 hover:bg-white rounded-xl border border-slate-200 transition-all shadow-sm"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="px-6 py-2 bg-white rounded-xl border border-slate-200 shadow-sm font-bold text-lg min-w-[200px] text-center">
                {format(selectedWeekStart, 'M월 d일')} - {format(addDays(selectedWeekStart, 4), 'M월 d일')}
              </div>
              <button 
                onClick={() => setSelectedWeekStart(addWeeks(selectedWeekStart, 1))}
                className="p-2 hover:bg-white rounded-xl border border-slate-200 transition-all shadow-sm"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <button 
                onClick={() => setSelectedWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                className="ml-2 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              >
                오늘
              </button>
            </div>

            <div className="flex items-center gap-4 text-sm text-slate-500">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 bg-white border border-slate-200 rounded-sm"></div>
                <span>예약 가능</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 bg-blue-100 border border-blue-200 rounded-sm"></div>
                <span>내 예약</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 bg-slate-200 rounded-sm"></div>
                <span>타인 예약</span>
              </div>
            </div>
          </div>

          {/* Grid View */}
          <div className="overflow-x-auto pb-4">
            <div className="min-w-[1000px]">
              {/* Grid Body */}
              <div className="space-y-12">
                {ROOMS.map((room) => (
                  <div key={room.id} className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-slate-100">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                          <MapPin className="w-5 h-5 text-blue-600" />
                        </div>
                        <h2 className="text-xl font-bold text-slate-800">{room.name}</h2>
                      </div>
                    </div>

                    {/* Section Header (Repeated for each room) */}
                    <div className="grid grid-cols-[80px_repeat(5,1fr)] gap-3 mb-6 border-b border-slate-50 pb-4">
                      <div className="flex items-center justify-center font-bold text-slate-300 uppercase text-[10px] tracking-widest">
                        시간
                      </div>
                      {weekDays.map((day, i) => (
                        <div key={i} className="text-center">
                          <div className="text-[11px] font-semibold text-slate-400 mb-0.5">
                            {format(day, 'EEEE', { locale: ko })}
                          </div>
                          <div className={cn(
                            "text-base font-bold",
                            isSameDay(day, new Date()) ? "text-blue-600" : "text-slate-900"
                          )}>
                            {format(day, 'M/d')}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="grid grid-cols-[80px_repeat(5,1fr)] gap-3">
                      <div className="flex flex-col gap-2">
                        {TIME_SLOTS.map(slot => (
                          <div key={slot} className="h-10 flex items-center justify-center text-sm font-mono text-slate-400">
                            {slot}:00
                          </div>
                        ))}
                      </div>

                      {weekDays.map((day, dayIdx) => (
                        <div key={dayIdx} className="flex flex-col gap-2">
                          {TIME_SLOTS.map(slot => {
                            const dateStr = format(day, 'yyyy-MM-dd');
                            const resId = `${dateStr}_${room.id}_${slot}`;
                            const reservation = reservations.find(r => r.id === resId);
                            const isOwn = reservation?.userId === user.uid;

                            return (
                              <div key={slot} className="relative h-10">
                                <button
                                  onClick={() => {
                                    if (reservation) {
                                      if (isOwn) setDeletingId(resId);
                                    } else {
                                      handleReservation(day, room.id, slot);
                                    }
                                  }}
                                  disabled={reservation && !isOwn}
                                  className={cn(
                                    "w-full h-full rounded-lg border transition-all flex flex-col items-center justify-center p-1 text-[11px] relative group overflow-hidden",
                                    !reservation && "bg-white border-slate-100 hover:border-blue-300 hover:bg-blue-50/30",
                                    reservation && isOwn && "bg-blue-50 border-blue-200 text-blue-700 font-semibold",
                                    reservation && !isOwn && "bg-slate-100 border-transparent text-slate-400 cursor-not-allowed"
                                  )}
                                >
                                  {reservation ? (
                                    <>
                                      <span className="truncate w-full text-center px-1">{reservation.userName}</span>
                                      {isOwn && (
                                        <div className="absolute inset-0 bg-red-500/0 group-hover:bg-red-500/90 flex items-center justify-center text-white transition-all">
                                          <Trash2 className="w-4 h-4 opacity-0 group-hover:opacity-100" />
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <span className="opacity-0 group-hover:opacity-100 text-blue-400 font-medium">예약</span>
                                  )}
                                </button>

                                <AnimatePresence>
                                  {deletingId === resId && (
                                    <motion.div 
                                      initial={{ opacity: 0, scale: 0.95 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      exit={{ opacity: 0, scale: 0.95 }}
                                      className="absolute inset-0 z-10 bg-white rounded-xl border border-red-200 shadow-lg flex flex-col items-center justify-center p-1"
                                    >
                                      <p className="text-[10px] text-red-600 font-bold mb-1">취소할까요?</p>
                                      <div className="flex gap-1">
                                        <button 
                                          onClick={() => handleDelete(resId, reservation!.userId)}
                                          className="px-2 py-0.5 bg-red-600 text-white rounded text-[10px] hover:bg-red-700"
                                        >
                                          네
                                        </button>
                                        <button 
                                          onClick={() => setDeletingId(null)}
                                          className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] hover:bg-slate-200"
                                        >
                                          아니오
                                        </button>
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>

        <footer className="max-w-7xl mx-auto p-8 text-center text-slate-400 text-sm">
          <p>© 2026 상담실 예약 시스템. 모든 권리 보유.</p>
        </footer>
      </div>
    </ErrorBoundary>
  );
}
