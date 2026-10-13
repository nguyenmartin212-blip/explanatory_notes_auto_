export type TravelInterest = 'history' | 'heritage' | 'culture' | 'food' | 'nature';

export type ItineraryInput = {
  days: number;
  people: number;
  interests: TravelInterest[];
};
