import makerjs from 'makerjs';
const model = {
    paths: {
        line1: new makerjs.paths.Line([0, 0], [10, 10])
    }
};
const dxf = makerjs.exporter.toDXF(model);
console.log(dxf);
