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
      <h1 className="text-2xl font-bold">記事作成ウィザード</h1>

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
    <div className="card p-3">
      <div className="flex items-center justify-between gap-1">
        {STEPS.map((s) => {
          const active = s.num === currentStep;
          const done = s.num < currentStep && canJumpTo(s.num);
          const enabled = canJumpTo(s.num);
          return (
            <button
              key={s.num}
              onClick={() => enabled && onJump(s.num)}
              disabled={!enabled}
              className={`flex-1 px-2 py-2 rounded text-xs md:text-sm font-medium transition-colors ${
                active
                  ? 'bg-brand-600 text-white'
                  : done
                    ? 'bg-brand-100 text-brand-700 hover:bg-brand-200'
                    : 'text-slate-500 hover:bg-slate-100 disabled:hover:bg-transparent disabled:cursor-not-allowed'
              }`}
            >
              <span className="block">Step {s.num}</span>
              <span className="block text-[10px] md:text-xs opacity-80">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
