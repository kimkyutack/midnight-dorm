import { AdMob } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';
import { isNativeApp } from './runtime';

const testMode = (import.meta.env.VITE_ADMOB_TEST_MODE as string | undefined) !== 'false';
const TEST_REWARDED_ANDROID = 'ca-app-pub-3940256099942544/5224354917';
const TEST_REWARDED_IOS = 'ca-app-pub-3940256099942544/1712485313';
let initialized = false;
let preparedKey = '';

function rewardedAdId(): string {
  const platform = Capacitor.getPlatform();
  if (testMode) return platform === 'ios' ? TEST_REWARDED_IOS : TEST_REWARDED_ANDROID;
  return platform === 'ios'
    ? (import.meta.env.VITE_ADMOB_IOS_REWARDED_ID as string | undefined)?.trim() ?? ''
    : (import.meta.env.VITE_ADMOB_ANDROID_REWARDED_ID as string | undefined)?.trim() ?? '';
}

export async function initializeAdMob(): Promise<void> {
  if (!isNativeApp || initialized) return;
  await AdMob.initialize({
    initializeForTesting: testMode,
    tagForChildDirectedTreatment: false,
    tagForUnderAgeOfConsent: false,
  });
  initialized = true;
}

export async function prepareStageClearReward(accountId: string, matchId: string): Promise<void> {
  await initializeAdMob();
  const adId = rewardedAdId();
  if (!isNativeApp || !adId) throw new Error('보상형 광고 단위가 설정되지 않았습니다.');
  const key = `${accountId}:${matchId}`;
  if (preparedKey === key) return;
  await AdMob.prepareRewardVideoAd({
    adId,
    isTesting: testMode,
    ssv: {
      userId: accountId,
      customData: JSON.stringify({ type: 'stage-clear-double', matchId }),
    },
  });
  preparedKey = key;
}

/**
 * 광고 SDK의 로컬 성공값은 보상 지급 근거가 아니다.
 * 실제 2배 보상은 AdMob SSV 콜백을 Worker가 검증한 뒤에만 지급한다.
 */
export async function showStageClearReward(accountId: string, matchId: string): Promise<void> {
  await prepareStageClearReward(accountId, matchId);
  await AdMob.showRewardVideoAd();
  preparedKey = '';
}

export async function showRandomBoxReward(accountId: string): Promise<void> {
  await initializeAdMob();
  const adId = rewardedAdId();
  if (!isNativeApp || !adId) throw new Error('보상형 광고는 Android·iOS 앱에서 이용할 수 있습니다.');
  const key = `${accountId}:daily-random-box`;
  if (preparedKey !== key) {
    await AdMob.prepareRewardVideoAd({
      adId,
      isTesting: testMode,
      ssv: {
        userId: accountId,
        customData: JSON.stringify({ type: 'daily-random-box' }),
      },
    });
    preparedKey = key;
  }
  await AdMob.showRewardVideoAd();
  preparedKey = '';
}
