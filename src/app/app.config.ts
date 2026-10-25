import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {provideHttpClient, withFetch} from '@angular/common/http';
import {provideRouter} from '@angular/router';

import {routes} from './app.routes';
import {AgentsService} from './core/agents.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withFetch()),
    provideRouter(routes),
    AgentsService,
  ],
};
