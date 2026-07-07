import { t } from '@/i18n';
import { ApiError } from './api';

/** Davomat (mobile check) xato kodlarini foydalanuvchiga tushunarli matnga aylantiradi. */
export function checkErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'OUT_OF_GEOFENCE': {
        const details = err.details as { distance?: number } | null;
        const distance = details?.distance;
        return distance != null
          ? t('errOutOfGeofence', { distance: Math.round(distance) })
          : t('errOutOfGeofenceNoDist');
      }
      case 'LIVENESS_FAILED':
        return t('errLiveness');
      case 'FACE_NOT_RECOGNIZED':
        return t('errFaceNotRecognized');
      case 'FACE_NOT_FOUND':
        return t('errFaceNotFound');
      case 'FACE_LOW_QUALITY':
        return t('errFaceLowQuality');
      case 'MOCK_LOCATION':
        return t('errMockLocation');
      case 'DEBOUNCE':
        return t('errDebounce');
      case 'NETWORK_ERROR':
        return t('errNetwork');
      case 'SUBSCRIPTION_EXPIRED':
        return t('errSubscriptionExpired');
      default:
        return err.message || t('errGeneric');
    }
  }
  return t('errGeneric');
}

/** Umumiy xatolar uchun (login, forms va h.k.) */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message || t('errGeneric');
  return t('errGeneric');
}
