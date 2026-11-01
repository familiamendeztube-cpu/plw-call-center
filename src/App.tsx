import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ServicesContext } from '@/app/ServicesContext';
import { APP_MODE } from '@/app/appConfig';
import type { AppServices } from '@/app/appServices';
import { AppRoutes } from '@/app/AppRoutes';
import { createDemoServices } from '@/demo/createDemoServices';
import { createProductionServices } from '@/production/createProductionServices';
import { AuthProvider } from '@/features/auth/context/AuthProvider';
import { SetupRequiredScreen } from '@/features/auth/components/SetupRequiredScreen';
import { TelephonyProvider } from '@/features/telephony/context/TelephonyProvider';

export default function App() {
  if (APP_MODE.kind === 'setup-required') {
    return (
      <SetupRequiredScreen missingKeys={APP_MODE.missingKeys} modeUnset={APP_MODE.modeUnset} />
    );
  }
  return <ConfiguredApp production={APP_MODE.kind === 'production'} />;
}

function ConfiguredApp({ production }: { production: boolean }) {
  const [services] = useState<AppServices>(() =>
    production ? createProductionServices() : createDemoServices()
  );

  return (
    <ServicesContext.Provider value={services}>
      <AuthProvider authService={services.auth}>
        <TelephonyProvider connector={services.telephony}>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TelephonyProvider>
      </AuthProvider>
    </ServicesContext.Provider>
  );
}
