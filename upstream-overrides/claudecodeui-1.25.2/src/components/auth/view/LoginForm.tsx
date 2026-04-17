import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { api } from '../../../utils/api';
import AuthErrorAlert from './AuthErrorAlert';
import AuthInputField from './AuthInputField';
import AuthScreenLayout from './AuthScreenLayout';

type LoginFormState = {
  username: string;
  password: string;
};

const initialState: LoginFormState = {
  username: '',
  password: '',
};

export default function LoginForm() {
  const { t } = useTranslation('auth');
  const { login } = useAuth();

  const [formState, setFormState] = useState<LoginFormState>(initialState);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [approvalMessage, setApprovalMessage] = useState('');

  const updateField = useCallback((field: keyof LoginFormState, value: string) => {
    setFormState((previous) => ({ ...previous, [field]: value }));
  }, []);

  const submitLogin = useCallback(
    async (isAutoRetry = false) => {
      const result = await login(formState.username.trim(), formState.password);
      if (!result.success) {
        if (result.approvalRequired) {
          setPendingApproval(true);
          setApprovalMessage(
            isAutoRetry
              ? 'Desktop approval is still pending. Checking again shortly...'
              : result.error,
          );
          return;
        }

        setErrorMessage(result.error);
        setPendingApproval(false);
        setApprovalMessage('');
        return;
      }

      setPendingApproval(false);
      setApprovalMessage('');
    },
    [formState.password, formState.username, login],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      if (!formState.username.trim() || !formState.password) {
        setErrorMessage(t('login.errors.requiredFields'));
        return;
      }

      setIsSubmitting(true);
      await submitLogin(false);
      setIsSubmitting(false);
    },
    [formState.password, formState.username, submitLogin, t],
  );

  useEffect(() => {
    if (!pendingApproval) {
      return undefined;
    }

    let cancelled = false;
    let timer = 0;
    let polling = false;

    const pollStatus = async () => {
      if (cancelled || polling) {
        return;
      }

      polling = true;
      try {
        const response = await api.auth.deviceApprovalStatus();
        const payload = await response.json().catch(() => null);
        const status = payload?.approvalStatus;

        if (status === 'approved') {
          cancelled = true;
          setApprovalMessage('Desktop approved this device. Completing sign-in...');
          setIsSubmitting(true);
          setErrorMessage('');
          await submitLogin(true);
          setIsSubmitting(false);
          return;
        }

        if (status === 'rejected') {
          cancelled = true;
          setPendingApproval(false);
          setApprovalMessage('');
          setErrorMessage(payload?.message || 'This device sign-in request was rejected on the desktop.');
          return;
        }

        if (!response.ok || status === 'superseded') {
          cancelled = true;
          setPendingApproval(false);
          setApprovalMessage('');
          setErrorMessage(payload?.error || payload?.message || 'Approval request expired. Please sign in again.');
          return;
        }

        setApprovalMessage(payload?.message || 'Waiting for desktop approval for this device.');
      } catch (error) {
        setApprovalMessage('Still waiting for desktop approval. Polling will retry automatically.');
      } finally {
        polling = false;
        if (!cancelled) {
          timer = window.setTimeout(() => {
            void pollStatus();
          }, 3000);
        }
      }
    };

    void pollStatus();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pendingApproval, submitLogin]);

  return (
    <AuthScreenLayout
      title={t('login.title')}
      description={t('login.description')}
      footerText="Sign in with your account password. New devices must be approved on the desktop before phone access is allowed."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInputField
          id="username"
          label={t('login.username')}
          value={formState.username}
          onChange={(value) => updateField('username', value)}
          placeholder={t('login.placeholders.username')}
          isDisabled={isSubmitting}
        />

        <AuthInputField
          id="password"
          label={t('login.password')}
          value={formState.password}
          onChange={(value) => updateField('password', value)}
          placeholder={t('login.placeholders.password')}
          isDisabled={isSubmitting}
          type="password"
        />

        <AuthErrorAlert errorMessage={errorMessage} />

        {pendingApproval ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {approvalMessage || 'Waiting for desktop approval for this device.'}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors duration-200 hover:bg-blue-700 disabled:bg-blue-400"
        >
          {isSubmitting ? t('login.loading') : t('login.submit')}
        </button>
      </form>
    </AuthScreenLayout>
  );
}
