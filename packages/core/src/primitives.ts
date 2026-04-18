export type PrimitiveId = string & { readonly __brand: 'PrimitiveId' };
export type Point = readonly [x: number, y: number];
export type Radians = number & { readonly __brand: 'Radians' };
