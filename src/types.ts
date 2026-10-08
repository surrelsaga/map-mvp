// Shared shapes. A position source (GPS, debug walk) produces Fix; everything downstream consumes it.
export interface LatLng { lat: number; lng: number }
export interface Fix extends LatLng { accuracy: number }   // accuracy in metres
