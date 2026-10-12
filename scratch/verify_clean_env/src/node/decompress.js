const zlib = require('zlib');
const utils = require('../utils');
const { isGzipOrDeflateEncoding, isBrotliEncoding } = utils;

exports.chooseDecompresser = (res) => {
  let decompresser;
  if (isGzipOrDeflateEncoding(res)) {
    decompresser = zlib.createUnzip();
  } else if (isBrotliEncoding(res)) {
    decompresser = zlib.createBrotliDecompress();
  } else {
    throw new Error('unknown content-encoding');
  }
  return decompresser;
}
