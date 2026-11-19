<!-- Draws both logo strokes together at the same speed, then retracts them in reverse, in a loop. -->
<svg
  class="loading-logo"
  aria-hidden="true"
  width="92"
  height="92"
  viewBox="0 0 92 92"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
>
  <path
    id="stroke-1"
    pathLength="1"
    d="M40.4 24.1C35.1 24.1 31.4 26.4 25.9 26.5C21.5 26.6 14 26.8 12.3 25.7C8.59998 23.5 9.99998 16.1 10.5 11C10.7 8.89998 11.2 4.84998 10.2 4.84998C9.09998 4.84998 6.69998 10.5 5.79998 14.2C4.99998 17.5 4.84998 20.6 4.84998 23.1C4.84998 26.8 8.49998 30.9 13.7 31.8C18.2 32.5 27.1 31.8 30.3 32C33.1 32.1 36 32.5 36.2 33.6C36.3 35.5 30.3 36 29.3 38.3C27.3 42.5 31 49.5 34.9 47.8C38.7 46.1 36.4 38 37.5 34.3C38.8 31.5 42.1 29.7 41.5 25.8C41.4 24.6 41.1 24.1 40.5 24.1"
  />
  <path
    id="stroke-2"
    pathLength="1"
    d="M44.735 26.9C44.135 42 36.435 59.5 30.935 74C29.435 77.8 30.035 81.5 32.335 84.8C33.535 86.4 36.735 85.9 38.235 85C41.035 82.8 43.135 79.9 44.135 76.2C45.035 72.8 41.235 75.3 39.335 76.8C37.435 78.3 35.435 80.7 37.835 81.7C39.335 82.3 42.635 79.3 43.235 77.2C44.335 74 41.935 74.1 39.735 74C36.835 74.1 34.335 71.8 32.335 74.1C29.035 77.7 28.535 81.4 32.435 85.8C35.135 88.8 39.235 91.15 43.135 91.15C46.635 91.15 48.735 89.4 50.935 87.5C54.335 84.5 53.535 83.4 53.035 79C51.635 70.6 58.135 58 63.335 45.5C64.235 43.3 64.935 41.7 63.535 40.9C62.435 40.2 59.935 41.8 59.235 43.2C58.335 45.3 61.635 46.4 65.735 43.2C68.835 40.9 69.535 35 71.035 34.5C72.535 34.4 72.435 40.1 73.435 45.5C74.535 51.8 75.935 58.7 73.335 63.7C70.935 68.4 63.235 76 56.335 82.9C52.535 86.7 54.135 81.9 58.335 77C62.935 71.7 63.535 67.2 65.535 58.5C67.435 50.5 68.235 46.4 73.935 43.8C79.735 41.8 83.835 41.1 86.235 38C88.835 35 85.935 29 82.435 28.8C70.035 28.2 58.635 31.1 53.435 37.4C49.235 42.1 48.835 47.6 43.735 62.9C42.635 66 41.535 69.5 40.235 69.5C37.135 69.5 38.035 65.9 37.635 61.1C37.235 55.2 36.135 52.4 36.135 48.3C36.135 46.2 36.835 42.4 35.235 43.3C33.435 44.3 34.935 48.7 37.235 46.7C39.435 44.9 40.335 39.8 40.435 36.6C40.635 32.4 39.735 30.5 40.235 26.5C40.735 21.7 43.235 19.7 48.935 19.7C55.735 19.7 56.435 17.9 59.035 18.2C61.935 18.2 64.935 21.6 72.935 24.6C80.235 27.5 88.135 28.1 91.035 23C91.735 21 88.935 18.9 85.735 19.1C81.835 19.1 78.535 19.2 75.135 18.1C77.335 16.9 85.035 16.7 88.435 17.8C92.935 19.2 91.035 22.7 87.235 24.3C81.935 26.4 75.835 24.8 69.935 21.1C65.535 18.4 63.535 17.1 61.335 13.8C59.735 11.4 57.835 8.39999 58.135 6.59999C58.535 4.49999 62.335 8.69999 64.635 10.6C69.035 14.2 73.535 17.5 77.135 19.1"
  />
</svg>

<style>
  /* Both strokes start together and move at the same speed (about 122 units/s). stroke-2 is
     ~4.1x longer than stroke-1 (634 vs 154 units), so stroke-1 finishes first and waits.
     Then everything retracts in exact reverse.
     Cycle = 5.2s forward + 0.4s hold + 5.2s reverse + 0.4s hold = 11.2s, which sets the keyframe
     percentages below. Change the duration to speed up or slow down both strokes together.
     pathLength="1" makes the dash values independent of each path's real length. The gap is 2
     (not 1) so that, when hidden, the next dash starts beyond the path's end instead of leaving
     a sliver there. The hidden offset is slightly past 1 so the round cap leaves no dot. */
  path {
    stroke: var(--ink);
    stroke-width: 1.7;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 1 2;
    stroke-dashoffset: 1.02;
    /* Longhands on purpose: the production CSS minifier turns a shorthand without a name
       (`animation: 11.2s linear infinite`) into `animation: none`, which hides the logo. */
    animation-duration: 11.2s;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
  }

  #stroke-1 {
    animation-name: trace-short;
  }

  #stroke-2 {
    animation-name: trace-long;
  }

  @keyframes trace-long {
    0% {
      stroke-dashoffset: 1.02;
    }
    46.43% {
      stroke-dashoffset: 0;
    }
    50% {
      stroke-dashoffset: 0;
    }
    96.43%,
    100% {
      stroke-dashoffset: 1.02;
    }
  }

  @keyframes trace-short {
    0% {
      stroke-dashoffset: 1.02;
    }
    11.31%,
    85.12% {
      stroke-dashoffset: 0;
    }
    96.43%,
    100% {
      stroke-dashoffset: 1.02;
    }
  }

  /* Without motion, show the finished logo. */
  @media (prefers-reduced-motion: reduce) {
    path {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
</style>
