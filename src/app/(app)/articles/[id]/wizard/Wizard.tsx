'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Step1Keywords from './steps/Step1Keywords';
import Step2Title from './steps/Step2Title';
import Step3Headings from './steps/Step3Headings';
import Step4Options from './steps/Step4Options';
import Step5Body from './steps/Step5Body';

export interface WizardState {
  step: number;
  keywords: string[];
  title: string;
  persona: string;
  searchIntent: string;
  latentNeeds: string[];
  toneSample: string;
  volumeSpec: string;
  customInstruction: string;
  referenceInfo: string;
  useWebSearch: boolean;
  modelChoice: 'low_cost' | 'balanced' | 'high_quality';
  headings: Array<{ id: string; level: number; text: string; parentId: string | null; order: number; bodyHtml: string | null }>;
  bodyHtml: string;
  metaDescription: string;
}

const STEPS = [
  { num: 1, label: 'キーワード' },
  { num: 2, label: 'タイトル' },
  { num: 3, label: '見出し構成' },
  { num: 4, label: 'オプション' },
  { num: 5, label: '本文生成' },
];

export default function Wizard({
  articleId,
  initialState,
}: {
  articleId: string;
  initialState: WizardState;
}) {
  const router = useRouter();
  const [state, setState] = useState(initialState);

  const goToStep = (step: number) => {
    setState((s) => ({ ...s, step }));
    fetch(`/api/articles/${articleId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step }),
    });
  };

  const noop = () => {};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-deep">記事作成ウィザード</h1>
        <p className="text-sm text-sub mt-1">キーワードから競合分析・SEO最適化された記事を生成します</p>
      </div>

      <StepIndicator currentStep={state.step} onJump={goToStep} state={state} />

      <div className="card p-6 md:p-8">
        {state.step === 1 && (
          <Step1Keywords
            articleId={articleId}
            state={state}
            setState={setState}
            onNext={() => goToStep(2)}
            onCreditsChange={noop}
          />
        )}
        {state.step === 2 && (
          <Step2Title
            articleId={articleId}
            state={state}
            setState={setState}
            onPrev={() => goToStep(1)}
            onNext={() => goToStep(3)}
            onCreditsChange={noop}
          />
        )}
        {state.step === 3 && (
          <Step3Headings
            articleId={articleId}
            state={state}
            setState={setState}
            onPrev={() => goToStep(2)}
            onNext={() => goToStep(4)}
            onCreditsChange={noop}
          />
        )}
        {state.step === 4 && (
          <Step4Options
            articleId={articleId}
            state={state}
            setState={setState}
            onPrev={() => goToStep(3)}
            onNext={() => goToStep(5)}
          />
        )}
        {state.step === 5 && (
          <Step5Body
            articleId={articleId}
            state={state}
            setState={setState}
            onPrev={() => goToStep(4)}
            onComplete={() => router.push(`/articles/${articleId}`)}
            onCreditsChange={noop}
          />
        )}
      </div>
    </div>
  );
}

function StepIndicator({
  currentStep,
  onJump,
  state,
}: {
  currentStep: number;
  onJump: (n: number) => void;
  state: WizardState;
}) {
  const canJumpTo = (n: number) => {
    if (n === 1) return true;
    if (n === 2) return state.keywords.length > 0;
    if (n === 3) return !!state.title;
    if (n === 4) return state.headings.length > 0;
    if (n === 5) return state.headings.length > 0;
    return false;
  };

  return (
    <div className="card p-4 md:p-5">
      <div className="flex items-center">
        {STEPS.map((s, i) => {
          const active = s.num === currentStep;
          const done = s.num < currentStep && canJumpTo(s.num);
          const enabled = canJumpTo(s.num);
          return (
            <div key={s.num} className="flex items-center flex-1 last:flex-none">
              <button
                onClick={() => enabled && onJump(s.num)}
                disabled={!enabled}
                className={`flex flex-col items-center gap-1.5 group ${enabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}
              >
                <span
                  className={`step-dot ${
                    active ? 'step-dot-current' : done ? 'step-dot-done' : 'step-dot-todo'
                  }`}
                >
                  {done ? (
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4L8.5 12l6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                  ) : (
                    s.num
                  )}
                </span>
                <span
                  className={`text-[10px] md:text-xs font-bold whitespace-nowrap ${
                    active ? 'text-teal-mid' : done ? 'text-navy' : 'text-sub'
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 md:mx-2 -mt-5 rounded-full ${done ? 'bg-teal' : 'bg-line'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
