import { UnsupportedFeatureError, ValidationError } from '@system-one-ai/core';
import type { EvaluateRequest, ImageInput } from '@system-one-ai/core';
import { nativeQuestions } from '@system-one-ai/protocol-system-one';

export function clefModel(model: string): 'clef' | 'clef-flash' | undefined {
  if (model === '@cf/cloudflare/clef') return 'clef';
  if (model === '@cf/cloudflare/clef-flash') return 'clef-flash';
  return undefined;
}

/** Core has validated the representation; only Clef's format and resource limits belong here. */
function clefImages(images: readonly ImageInput[]) {
  if (images.length > 4) throw new ValidationError('images', 'Clef accepts at most four images');
  let totalBytes = 0;
  return images.map((image, index) => {
    const comma = typeof image === 'string' ? image.indexOf(',') : -1;
    const mediaType = typeof image === 'string' ? image.slice(5, image.indexOf(';')) : image.mediaType;
    const base64 = typeof image === 'string' ? image.slice(comma + 1) : image.base64;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mediaType.toLowerCase())) {
      throw new ValidationError(`images[${index}]`, 'Clef accepts only PNG, JPEG or WebP images');
    }
    const bytes = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
    if (bytes > 4 * 1024 * 1024) throw new ValidationError(`images[${index}]`, 'Clef image exceeds 4 MiB of decoded bytes');
    totalBytes += bytes;
    if (totalBytes > 8 * 1024 * 1024) throw new ValidationError('images', 'Clef images exceed 8 MiB of total decoded bytes');
    return typeof image === 'string' ? image : { content_type: mediaType.toLowerCase(), base64 };
  });
}

/** Shared REST/binding codec; callers supply core's validated request snapshot. */
export function cloudflareInput(model: string, request: EvaluateRequest): Record<string, unknown> {
  const selector = clefModel(model);
  if (request.providerOptions !== undefined && Object.keys(request.providerOptions).length > 0) {
    throw new UnsupportedFeatureError('The Cloudflare decision protocol does not define providerOptions.');
  }
  if (request.images?.length && selector === undefined) {
    throw new UnsupportedFeatureError('Image input requires a Cloudflare Clef model.');
  }
  return {
    ...(selector === undefined ? {} : { model: selector }),
    state: request.state,
    questions: nativeQuestions(request.questions),
    ...(selector === undefined || request.images === undefined ? {} : { images: clefImages(request.images) }),
  };
}
