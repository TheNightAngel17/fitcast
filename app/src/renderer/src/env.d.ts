import type { FitCastAPI } from '../../preload/index';

declare global {
  interface Window {
    fitcast: FitCastAPI;
  }
}
