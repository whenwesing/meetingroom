export interface Reservation {
  id: string;
  date: string; // YYYY-MM-DD
  roomId: string;
  timeSlot: number; // 8, 9, 10...
  userName: string;
  userId: string;
  createdAt: any;
}

export const ROOMS = [
  { id: '311', name: '311호' },
  { id: '312', name: '312호' },
  { id: '313', name: '313호' },
  { id: '314', name: '314호' },
  { id: 'glass', name: '유리방' },
];

export const TIME_SLOTS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
