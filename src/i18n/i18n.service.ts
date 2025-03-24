import { Injectable } from '@nestjs/common';
import * as uz from './uz.json';
import * as ru from './ru.json';

@Injectable()
export class I18nService {
  private translations = { uz, ru };

  getTranslation(key: string, lang: string = 'uz'): string {
    const language = this.translations[lang] || this.translations['uz'];
    const keys = key.split('.');
    let result = language;
    for (const k of keys) {
      result = result[k];
      if (!result) return key;
    }
    return result;
  }

  getValidationErrors(errors: any[], lang: string = 'uz'): any[] {
    return errors.map((err) => ({
      [err.property]: err.constraints
        ? Object.keys(err.constraints).map((k) =>
            this.getTranslation(`validation.${err.property}_${k}`, lang),
          )
        : [],
    }));
  }
}
