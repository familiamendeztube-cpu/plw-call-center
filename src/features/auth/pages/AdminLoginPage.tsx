import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/useAuth';
import { AdminLoginScreen } from '@/features/auth/components/AdminLoginScreen';

export function AdminLoginPage() {
  const { session, notice, deviceRequired, signInAdmin, enrollDevice, getOwnerSetupState } =
    useAuth();
  const [setupAvailable, setSetupAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    void getOwnerSetupState().then((state) => {
      if (active) setSetupAvailable(state?.setupAvailable === true);
    });
    return () => {
      active = false;
    };
  }, [getOwnerSetupState]);

  if (session) {
    return <Navigate to={session.role === 'admin' ? '/admin/resumen' : '/bandeja'} replace />;
  }

  return (
    <AdminLoginScreen
      onSignIn={(passcode) => signInAdmin({ passcode })}
      onEnrollDevice={(code, label) => enrollDevice({ code, label })}
      deviceRequired={deviceRequired}
      notice={notice}
      setupAvailable={setupAvailable}
    />
  );
}
