import {
  TrainingParamSpec,
  defaultTrainingParams,
  trainingParamAdvisories,
  validateTrainingParams,
} from './trainingModels';

// These cover the two things `validateTrainingParams` could not express
// before: a minimum the backend means exclusively, and a value that is legal
// but expensive enough to be worth saying something about.
//
// The specs are written out rather than read from `trainingParamsFor`, so a
// change to the fallback table cannot quietly turn one of these green.

const spec = (over: Partial<TrainingParamSpec> & { name: string }): TrainingParamSpec => ({
  label: over.name,
  appliesTo: ['cellpose'],
  type: 'number',
  default: null,
  ...over,
});

const LEARNING_RATE = spec({ name: 'learning_rate', label: 'Learning rate', default: 1e-5, min: 0 });
const DIAM_MEAN = spec({ name: 'diam_mean', label: 'Mean diameter', default: 30, min: 0 });
const VAL_FRACTION = spec({ name: 'val_fraction', label: 'Validation fraction', default: 0.2, min: 0, max: 0.9 });
const N_EPOCHS = spec({ name: 'n_epochs', label: 'Epochs', type: 'integer', default: 5, min: 1 });
const BATCH_SIZE = spec({ name: 'batch_size', label: 'Batch size', type: 'integer', default: 1, min: 1 });

describe('validateTrainingParams, exclusive minimums', () => {
  it('rejects a learning rate of 0 and says what it would do', () => {
    const { error } = validateTrainingParams([LEARNING_RATE], { learning_rate: '0' });
    expect(error).toContain('Learning rate must be greater than 0');
    expect(error).toContain('trains the model to no effect');
  });

  it('rejects a mean diameter of 0', () => {
    const { error } = validateTrainingParams([DIAM_MEAN], { diam_mean: '0' });
    expect(error).toContain('Mean diameter must be greater than 0');
  });

  it('still accepts a small positive learning rate', () => {
    const { values, error } = validateTrainingParams([LEARNING_RATE], { learning_rate: '0.00001' });
    expect(error).toBeNull();
    expect(values.learning_rate).toBe(0.00001);
  });

  // The reason the exclusive minimum is a per-parameter list and not a blanket
  // rule for floats reporting `min: 0`.
  it('leaves a validation fraction of 0 alone, which means train without validation', () => {
    const { values, error } = validateTrainingParams([VAL_FRACTION], { val_fraction: '0' });
    expect(error).toBeNull();
    expect(values.val_fraction).toBe(0);
  });

  it('still enforces the inclusive bounds it always did', () => {
    expect(validateTrainingParams([N_EPOCHS], { n_epochs: '0' }).error).toContain('at least 1');
    expect(validateTrainingParams([VAL_FRACTION], { val_fraction: '0.95' }).error).toContain('at most 0.9');
    expect(validateTrainingParams([N_EPOCHS], { n_epochs: '2.5' }).error).toContain('whole number');
  });

  it('drops an empty field rather than sending it as zero', () => {
    const { values, error } = validateTrainingParams([LEARNING_RATE], { learning_rate: '' });
    expect(error).toBeNull();
    expect(values).not.toHaveProperty('learning_rate');
  });
});

describe('trainingParamAdvisories', () => {
  it('says nothing about the defaults', () => {
    const specs = [N_EPOCHS, BATCH_SIZE, LEARNING_RATE];
    expect(trainingParamAdvisories(specs, defaultTrainingParams(specs))).toEqual([]);
  });

  it('names the cost of a long run, without blocking it', () => {
    const advisories = trainingParamAdvisories([N_EPOCHS], { n_epochs: '500' });
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toContain('500 epochs');
    // The point of the advisory is the consequence, not the number.
    expect(advisories[0]).toContain('Training time');
    // And it is advice, so the same value must still validate.
    expect(validateTrainingParams([N_EPOCHS], { n_epochs: '500' }).error).toBeNull();
  });

  it('warns about a batch size that may not fit, and says when it would find out', () => {
    const advisories = trainingParamAdvisories([BATCH_SIZE], { batch_size: '64' });
    expect(advisories).toHaveLength(1);
    expect(advisories[0]).toContain('fails later');
  });

  it('stays quiet for a parameter it has no advice about', () => {
    expect(trainingParamAdvisories([LEARNING_RATE], { learning_rate: '0.5' })).toEqual([]);
  });
});
