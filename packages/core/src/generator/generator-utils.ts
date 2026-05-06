import {
  ConvertToJSType,
  GetLeoArrTypeAndSize,
  getNestedType,
  IsLeoArray,
  IsLeoExternalStruct,
  IsLeoPrimitiveType,
  IsLeoExternalRecord
} from '@/utils/aleo-utils';
import { GetConverterFunctionName, GetExternalStructAlias } from './leo-naming';
import { DokoJSError, ERRORS } from '@doko-js/utils';
import { STRING_JS } from './string-constants';

const IDENTIFIER_TYPE = 'identifier';
const DYNAMIC_RECORD_TYPE = 'dynamic';
const DYNAMIC_RECORD_INPUT_TYPE = 'DynamicRecordInput';
const DYNAMIC_RECORD_VALUE_TYPE = 'Record<string, unknown> | string';

function IsLeoDynamicRecordType(type: string) {
  return type === DYNAMIC_RECORD_TYPE;
}

function stringifyDynamicLeoValue(input: string) {
  return `js2leo.serializeDynamicRecord(${input})`;
}

function GetPrimitiveConversionFunctionReference(
  type: string,
  conversionTo: string
) {
  const namespace = conversionTo === 'js' ? 'leo2js' : 'js2leo';

  if (type === IDENTIFIER_TYPE) {
    return `${namespace}.${type}`;
  }

  return `${namespace}.${type}`;
}

export function generateArgType(type: string, depth: number): string {
  for (let i = 0; i < depth; i++) {
    type = `Array<${type}>`;
  }
  return type;
};
export function InferJSDataType(type: string): string {
  if(IsLeoArray(type)) {
    const [nestedType, depth] = getNestedType(type);
    const tsType = IsLeoDynamicRecordType(nestedType)
      ? DYNAMIC_RECORD_VALUE_TYPE
      : ConvertToJSType(nestedType) || nestedType;
    const argType = generateArgType(tsType, depth);
    return argType;
  }
  if (IsLeoDynamicRecordType(type)) {
    return DYNAMIC_RECORD_VALUE_TYPE;
  }
  if (
    IsLeoPrimitiveType(type) ||
    IsLeoExternalRecord(type)
  ) {
    const tsType = ConvertToJSType(type);
    if (tsType) return tsType;
    else
      throw new DokoJSError(ERRORS.ARTIFACTS.UNDECLARED_TYPE, {
        value: type
      });
  }
  return type;
}

export function InferJSInputDataType(type: string): string {
  if (IsLeoArray(type)) {
    const [nestedType, depth] = getNestedType(type);
    const tsType = IsLeoDynamicRecordType(nestedType)
      ? `${DYNAMIC_RECORD_INPUT_TYPE} | string`
      : ConvertToJSType(nestedType) || nestedType;
    return generateArgType(tsType, depth);
  }
  if (IsLeoDynamicRecordType(type)) {
    return `${DYNAMIC_RECORD_INPUT_TYPE} | string`;
  }
  return InferJSDataType(type);
}

export function GenerateAsteriskTSImport(location: string, alias: string) {
  return `import * as ${alias} from "${location}";`;
}

export function GenerateTSImport(
  types: string[],
  location: string,
  aliases?: Array<string | null>
) {
  if (aliases) {
    if (aliases.length !== types.length) {
      throw new DokoJSError(ERRORS.ARTIFACTS.INVALID_ALIAS_COUNT, {
        expected: types.length,
        received: aliases.length
      });
    }
    types = types.map((type, index) =>
      aliases[index] !== null ? `${type} as ${aliases[index]}` : type
    );
  }
  // Create import statement for custom types
  return `import {\n ${types.join(',\n')}} from "${location}";`;
}

// Generate statement to convert type back and forth
// Eg: private(js2leo.u32(count))
// type: u32.private
// inputField: input to u32 function
// conversionTo: js or leo
export function GenerateTypeConversionStatement(
  leoType: string,
  inputField: string,
  conversionTo: string
) {
  // Split qualifier private/public
  const [type, qualifier] = leoType.split('.');

  if (IsLeoDynamicRecordType(type)) {
    return conversionTo === 'leo'
      ? `typeof ${inputField} === 'string' ? ${inputField} : ${stringifyDynamicLeoValue(inputField)}`
      : inputField;
  }

  // Determine member conversion function
  const conversionFnName = GetConverterFunctionName(type, conversionTo);

  const namespace = conversionTo === 'js' ? 'leo2js' : 'js2leo';

  let fn = `${conversionFnName}(${inputField})`;

  if (IsLeoArray(type)) {
    const [nestedType, depth] = getNestedType(type);
    const conversionFn = IsLeoDynamicRecordType(nestedType)
      ? conversionTo === 'leo'
        ? `(value: ${DYNAMIC_RECORD_INPUT_TYPE} | string) => typeof value === 'string' ? value : ${stringifyDynamicLeoValue('value')}`
        : '(value: Record<string, unknown> | string) => value'
      : IsLeoPrimitiveType(nestedType)
        ? GetPrimitiveConversionFunctionReference(nestedType, conversionTo)
      : GetConverterFunctionName(nestedType, conversionTo);
    if (depth === 1) {
      fn = `${namespace}.${conversionFnName}(${inputField}, ${conversionFn})`;
      if(qualifier && conversionTo === 'leo') {
        fn = `${namespace}.${conversionFnName}(${fn}, ${namespace}.${qualifier}Field)`;
      }
    } else {
      for (let i = 1; i < depth; i++) {
        inputField += `.map(element${i} =>`;
      }
      if(qualifier && conversionTo === 'leo') {
        inputField += `${namespace}.${conversionFnName}(${namespace}.${conversionFnName}(element${depth - 1}, ${conversionFn}), ${namespace}.${qualifier}Field)`;
      } else {
        inputField += ` ${namespace}.${conversionFnName}(element${depth - 1}, ${conversionFn})`;
      }
      for (let i = 1; i < depth; i++) {
        inputField += ')';
      }
      fn = inputField;
    }
    // if(qualifier) {
    //   fn = `${namespace}.${conversionFnName}(${fn}, ${namespace}.${qualifier}Field)`;
    // }
  }
  // if this is not a custom type we have to use the
  // conversion function from namespace
  else if (IsLeoPrimitiveType(type)) {
    if (type === IDENTIFIER_TYPE) {
      fn = `${namespace}.${fn}`;
    } else {
      fn = `${namespace}.${fn}`;
    }

    if (conversionTo === 'leo') {
      if (qualifier) {
        fn = `${namespace}.${qualifier}Field(${fn})`;
      }
    }
  }

  return fn;
}

// Return list of function involved in conversion of the given type
export function GetTypeConversionFunctionsJS(leoType: string) {
  // Split qualifier private/public
  const [type, qualifier] = leoType.split('.');

  if (IsLeoDynamicRecordType(type)) {
    return ['(value: Record<string, unknown> | string) => value'];
  }

  const functions = [];
  // Determine member conversion function
  const namespace = 'leo2js';
  const conversionFnName = GetConverterFunctionName(type, STRING_JS);
  const isArray = IsLeoArray(type);

  const isLeoType = isArray || IsLeoPrimitiveType(type);
  functions.push(
    (isArray || IsLeoPrimitiveType(type) || IsLeoDynamicRecordType(type))
      ? IsLeoPrimitiveType(type)
        ? GetPrimitiveConversionFunctionReference(type, STRING_JS)
        : IsLeoDynamicRecordType(type)
          ? '(value: Record<string, unknown> | string) => value'
        : `${namespace}.${conversionFnName}`
      : conversionFnName
  );

  if (isArray) {
    // Pass additional conversion function
    const [dataType] = GetLeoArrTypeAndSize(type);
    functions.push(
      IsLeoPrimitiveType(dataType)
        ? GetPrimitiveConversionFunctionReference(dataType, STRING_JS)
        : IsLeoDynamicRecordType(dataType)
          ? '(value: Record<string, unknown> | string) => value'
        : `${namespace}.${dataType}`
    );
  }
  return functions;
}

export function InferExternalRecordInputDataType(recordType: string) {
  const parts = recordType.replace('.record', '').split('.aleo/');
  const program = parts[0];
  const record = parts[1];

  return `${program}_${record}`;
}

export function GenerateExternalRecordConversionStatement(
  recordType: string,
  value: string,
  converstionTo: string
) {
  const parts = recordType.replace('.record', '').split('.aleo/');
  const program = parts[0];
  const record = parts[1];

  if (converstionTo === 'js') {
    return ['leo2js.externalRecord', `'${program}.aleo/${record}'`];
  } else {
    return `js2leo.json(${program}_${GetConverterFunctionName(record, 'leo')}(${value}))`;
  }
}

export function AliasExternalStructDataType(type: string): string {
  if (!IsLeoExternalStruct(type)) return type;

  return type.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\.aleo\/([a-zA-Z_][a-zA-Z0-9_]*)\b/g,
    (_, programName: string, structName: string) =>
      GetExternalStructAlias(programName, structName)
  );
}

// Resolve import return types
// Some return types are referenced by import file
// Eg: token.leo/token.record
export function FormatLeoDataType(type: string): string {
  return type.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\.aleo\//g, '');
}

export function GenerateZkRunCode(transitionName: string) {
  return `const result = await this.ctx.execute('${transitionName}', params);\n`;
}

export function GenerateZkMappingCode(mappingName: string) {
  return `\tconst result = await zkGetMapping(
        this.config,
        '${mappingName}',
        params[0],
      );\n`;
}
