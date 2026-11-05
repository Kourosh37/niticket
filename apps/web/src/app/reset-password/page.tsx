import { Suspense } from 'react';
import { AuthForm } from '@/components/auth-form';
import { AuthLayout } from '@/components/auth-layout';

export default function Reset() {
  return (
    <AuthLayout>
      <Suspense fallback={<p>در حال بارگذاری…</p>}>
        <AuthForm mode="reset" />
      </Suspense>
    </AuthLayout>
  );
}
