export const colors = {
  // Go to Horizon — editorial heritage palette from the Figma Make reference.
  background: '#F4F0E6',
  surface: '#FFFDF8',
  primary: '#C76549',
  primaryDark: '#A64A3A',
  teal: '#123C3A',
  text: '#18302E',
  muted: '#747B76',
  border: '#DDD5C8',

  // Extra semantic surfaces. Existing screens can keep using the original keys above.
  sand: '#E9DDC9',
  green: '#DCE9E1',
  error: '#A64A3A',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
} as const;
