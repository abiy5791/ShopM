/**
 * The ShopM mark, drawn with `fill="currentColor"` so it recolors with the
 * surrounding text color (dark on the light login screen, light on the dark
 * sidebar). To change the artwork, edit the paths here — this is the single
 * in-app source. `public/logo.svg` is the standalone black copy for the favicon.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      fill="currentColor"
      role="img"
      aria-label="ShopM"
    >
      {/* Apex spire sweeping down the right leg of the triangle */}
      <path d="M243 138 C 262 205 300 270 352 320 C 372 339 393 351 414 358 C 388 340 362 315 338 283 C 305 240 275 190 254 137 Z" />
      {/* Left flourish / teardrop curl */}
      <path d="M215 210 C 213 248 205 276 182 292 C 168 302 152 306 176 308 C 205 310 224 296 230 268 C 234 246 228 224 218 209 Z" />
      {/* Central arch forming the negative-space 'A' crossbar */}
      <path d="M256 258 C 292 258 322 282 328 318 C 330 335 324 350 309 358 C 331 352 346 335 346 313 C 346 278 312 250 268 250 C 244 250 224 258 213 272 C 227 262 240 258 256 258 Z" />
      {/* Left foot flame */}
      <path d="M176 305 C 172 330 158 348 132 358 C 158 359 182 350 196 330 C 204 319 205 310 200 302 C 191 300 183 302 176 305 Z" />
      {/* Base rule tying the feet across the bottom */}
      <path d="M132 356 h 90 v 4 h -90 Z M309 356 h 105 v 4 h -105 Z" />
    </svg>
  );
}
