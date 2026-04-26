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

export const TIME_SLOTS = [8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16, 16.5, 17, 17.5];
