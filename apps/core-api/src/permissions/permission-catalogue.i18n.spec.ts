import { PERMISSION_CATALOGUE } from './permission-catalogue.js';

const MAX_LABEL_LENGTH = 60;

describe('permission catalogue labels', () => {
  it.each(['de', 'en'] as const)(
    'gives every permission a short %s label',
    (language) => {
      const bad = PERMISSION_CATALOGUE.filter((permission) => {
        const label = permission.label[language];
        return (
          label.trim() === '' ||
          label !== label.trim() ||
          label.length > MAX_LABEL_LENGTH
        );
      }).map((permission) => permission.id);

      expect(bad).toEqual([]);
    },
  );
});
