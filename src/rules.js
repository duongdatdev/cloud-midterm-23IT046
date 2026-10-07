export const STUDENT = Object.freeze({
  name: 'Dương Bảo Đạt',
  id: '23IT046',
  prefix: '046',
  vatPercent: 12,
  database: 'DB_23IT046'
});

export class ValidationError extends Error {}

export function validateBook(input) {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const author = typeof input.author === 'string' ? input.author.trim() : '';
  const rawPrice = typeof input.price === 'string' ? input.price.trim() : '';
  if (!/^046[A-Z0-9_-]{0,29}$/.test(code)) {
    throw new ValidationError('Mã sách phải bắt đầu bằng 046, tối đa 32 ký tự, chỉ gồm chữ, số, dấu - hoặc _.');
  }
  if (!title || title.length > 200) {
    throw new ValidationError('Tên sách bắt buộc, tối đa 200 ký tự.');
  }
  if (!author || author.length > 120) {
    throw new ValidationError('Tác giả bắt buộc, tối đa 120 ký tự.');
  }
  if (!/^\d{1,10}$/.test(rawPrice)) {
    throw new ValidationError('Giá phải là số nguyên dương tính bằng đồng.');
  }
  const priceBeforeTax = Number(rawPrice);
  if (priceBeforeTax < 1 || priceBeforeTax > 1000000000) {
    throw new ValidationError('Giá phải từ 1 đến 1.000.000.000 đồng.');
  }
  const vatAmount = Math.round(priceBeforeTax * STUDENT.vatPercent / 100);
  return {
    _id: code,
    code,
    title,
    author,
    priceBeforeTax,
    vatPercent: STUDENT.vatPercent,
    vatAmount,
    priceAfterTax: priceBeforeTax + vatAmount,
    createdAt: new Date()
  };
}

export function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

