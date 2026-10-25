/**
 * Generated from engine.js — DO NOT EDIT BY HAND.
 *
 * Regen with `bun ./code-graph.regen.js` in this directory. Bundled with
 * Bun.build (target node, format esm; node:* builtins and the vendored
 * TypeScript compiler API external) so the engine ships inline: the
 * packaged web server runs under plain Node with no transpile step, where a
 * static `.ts` import fails.
 */
// ../../../../omo-engine/code-graph/src/extract.ts
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/completionItemKind.js
var CompletionItemKind;
(function(CompletionItemKind) {
  CompletionItemKind[CompletionItemKind["Text"] = 1] = "Text";
  CompletionItemKind[CompletionItemKind["Method"] = 2] = "Method";
  CompletionItemKind[CompletionItemKind["Function"] = 3] = "Function";
  CompletionItemKind[CompletionItemKind["Constructor"] = 4] = "Constructor";
  CompletionItemKind[CompletionItemKind["Field"] = 5] = "Field";
  CompletionItemKind[CompletionItemKind["Variable"] = 6] = "Variable";
  CompletionItemKind[CompletionItemKind["Class"] = 7] = "Class";
  CompletionItemKind[CompletionItemKind["Interface"] = 8] = "Interface";
  CompletionItemKind[CompletionItemKind["Module"] = 9] = "Module";
  CompletionItemKind[CompletionItemKind["Property"] = 10] = "Property";
  CompletionItemKind[CompletionItemKind["Unit"] = 11] = "Unit";
  CompletionItemKind[CompletionItemKind["Value"] = 12] = "Value";
  CompletionItemKind[CompletionItemKind["Enum"] = 13] = "Enum";
  CompletionItemKind[CompletionItemKind["Keyword"] = 14] = "Keyword";
  CompletionItemKind[CompletionItemKind["Snippet"] = 15] = "Snippet";
  CompletionItemKind[CompletionItemKind["Color"] = 16] = "Color";
  CompletionItemKind[CompletionItemKind["File"] = 17] = "File";
  CompletionItemKind[CompletionItemKind["Reference"] = 18] = "Reference";
  CompletionItemKind[CompletionItemKind["Folder"] = 19] = "Folder";
  CompletionItemKind[CompletionItemKind["EnumMember"] = 20] = "EnumMember";
  CompletionItemKind[CompletionItemKind["Constant"] = 21] = "Constant";
  CompletionItemKind[CompletionItemKind["Struct"] = 22] = "Struct";
  CompletionItemKind[CompletionItemKind["Event"] = 23] = "Event";
  CompletionItemKind[CompletionItemKind["Operator"] = 24] = "Operator";
  CompletionItemKind[CompletionItemKind["TypeParameter"] = 25] = "TypeParameter";
})(CompletionItemKind || (CompletionItemKind = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/diagnosticCategory.js
var DiagnosticCategory;
(function(DiagnosticCategory) {
  DiagnosticCategory[DiagnosticCategory["Warning"] = 0] = "Warning";
  DiagnosticCategory[DiagnosticCategory["Error"] = 1] = "Error";
  DiagnosticCategory[DiagnosticCategory["Suggestion"] = 2] = "Suggestion";
  DiagnosticCategory[DiagnosticCategory["Message"] = 3] = "Message";
})(DiagnosticCategory || (DiagnosticCategory = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/elementFlags.js
var ElementFlags;
(function(ElementFlags) {
  ElementFlags[ElementFlags["None"] = 0] = "None";
  ElementFlags[ElementFlags["Required"] = 1] = "Required";
  ElementFlags[ElementFlags["Optional"] = 2] = "Optional";
  ElementFlags[ElementFlags["Rest"] = 4] = "Rest";
  ElementFlags[ElementFlags["Variadic"] = 8] = "Variadic";
  ElementFlags[ElementFlags["Fixed"] = 3] = "Fixed";
  ElementFlags[ElementFlags["Variable"] = 12] = "Variable";
  ElementFlags[ElementFlags["NonRequired"] = 14] = "NonRequired";
  ElementFlags[ElementFlags["NonRest"] = 11] = "NonRest";
})(ElementFlags || (ElementFlags = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/moduleKind.js
var ModuleKind;
(function(ModuleKind) {
  ModuleKind[ModuleKind["None"] = 0] = "None";
  ModuleKind[ModuleKind["CommonJS"] = 1] = "CommonJS";
  ModuleKind[ModuleKind["AMD"] = 2] = "AMD";
  ModuleKind[ModuleKind["UMD"] = 3] = "UMD";
  ModuleKind[ModuleKind["System"] = 4] = "System";
  ModuleKind[ModuleKind["ES2015"] = 5] = "ES2015";
  ModuleKind[ModuleKind["ES2020"] = 6] = "ES2020";
  ModuleKind[ModuleKind["ES2022"] = 7] = "ES2022";
  ModuleKind[ModuleKind["ESNext"] = 99] = "ESNext";
  ModuleKind[ModuleKind["Node16"] = 100] = "Node16";
  ModuleKind[ModuleKind["Node18"] = 101] = "Node18";
  ModuleKind[ModuleKind["Node20"] = 102] = "Node20";
  ModuleKind[ModuleKind["NodeNext"] = 199] = "NodeNext";
  ModuleKind[ModuleKind["Preserve"] = 200] = "Preserve";
})(ModuleKind || (ModuleKind = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/nodeBuilderFlags.js
var NodeBuilderFlags;
(function(NodeBuilderFlags) {
  NodeBuilderFlags[NodeBuilderFlags["None"] = 0] = "None";
  NodeBuilderFlags[NodeBuilderFlags["NoTruncation"] = 1] = "NoTruncation";
  NodeBuilderFlags[NodeBuilderFlags["WriteArrayAsGenericType"] = 2] = "WriteArrayAsGenericType";
  NodeBuilderFlags[NodeBuilderFlags["GenerateNamesForShadowedTypeParams"] = 4] = "GenerateNamesForShadowedTypeParams";
  NodeBuilderFlags[NodeBuilderFlags["UseStructuralFallback"] = 8] = "UseStructuralFallback";
  NodeBuilderFlags[NodeBuilderFlags["ForbidIndexedAccessSymbolReferences"] = 16] = "ForbidIndexedAccessSymbolReferences";
  NodeBuilderFlags[NodeBuilderFlags["WriteTypeArgumentsOfSignature"] = 32] = "WriteTypeArgumentsOfSignature";
  NodeBuilderFlags[NodeBuilderFlags["UseFullyQualifiedType"] = 64] = "UseFullyQualifiedType";
  NodeBuilderFlags[NodeBuilderFlags["UseOnlyExternalAliasing"] = 128] = "UseOnlyExternalAliasing";
  NodeBuilderFlags[NodeBuilderFlags["SuppressAnyReturnType"] = 256] = "SuppressAnyReturnType";
  NodeBuilderFlags[NodeBuilderFlags["WriteTypeParametersInQualifiedName"] = 512] = "WriteTypeParametersInQualifiedName";
  NodeBuilderFlags[NodeBuilderFlags["MultilineObjectLiterals"] = 1024] = "MultilineObjectLiterals";
  NodeBuilderFlags[NodeBuilderFlags["WriteClassExpressionAsTypeLiteral"] = 2048] = "WriteClassExpressionAsTypeLiteral";
  NodeBuilderFlags[NodeBuilderFlags["UseTypeOfFunction"] = 4096] = "UseTypeOfFunction";
  NodeBuilderFlags[NodeBuilderFlags["OmitParameterModifiers"] = 8192] = "OmitParameterModifiers";
  NodeBuilderFlags[NodeBuilderFlags["UseAliasDefinedOutsideCurrentScope"] = 16384] = "UseAliasDefinedOutsideCurrentScope";
  NodeBuilderFlags[NodeBuilderFlags["UseSingleQuotesForStringLiteralType"] = 268435456] = "UseSingleQuotesForStringLiteralType";
  NodeBuilderFlags[NodeBuilderFlags["NoTypeReduction"] = 536870912] = "NoTypeReduction";
  NodeBuilderFlags[NodeBuilderFlags["UseInstantiationExpressions"] = 1073741824] = "UseInstantiationExpressions";
  NodeBuilderFlags[NodeBuilderFlags["OmitThisParameter"] = 33554432] = "OmitThisParameter";
  NodeBuilderFlags[NodeBuilderFlags["WriteCallStyleSignature"] = 134217728] = "WriteCallStyleSignature";
  NodeBuilderFlags[NodeBuilderFlags["AllowThisInObjectLiteral"] = 32768] = "AllowThisInObjectLiteral";
  NodeBuilderFlags[NodeBuilderFlags["AllowQualifiedNameInPlaceOfIdentifier"] = 65536] = "AllowQualifiedNameInPlaceOfIdentifier";
  NodeBuilderFlags[NodeBuilderFlags["AllowAnonymousIdentifier"] = 131072] = "AllowAnonymousIdentifier";
  NodeBuilderFlags[NodeBuilderFlags["AllowEmptyUnionOrIntersection"] = 262144] = "AllowEmptyUnionOrIntersection";
  NodeBuilderFlags[NodeBuilderFlags["AllowEmptyTuple"] = 524288] = "AllowEmptyTuple";
  NodeBuilderFlags[NodeBuilderFlags["AllowUniqueESSymbolType"] = 1048576] = "AllowUniqueESSymbolType";
  NodeBuilderFlags[NodeBuilderFlags["AllowEmptyIndexInfoType"] = 2097152] = "AllowEmptyIndexInfoType";
  NodeBuilderFlags[NodeBuilderFlags["AllowNodeModulesRelativePaths"] = 67108864] = "AllowNodeModulesRelativePaths";
  NodeBuilderFlags[NodeBuilderFlags["IgnoreErrors"] = 70221824] = "IgnoreErrors";
  NodeBuilderFlags[NodeBuilderFlags["InObjectTypeLiteral"] = 4194304] = "InObjectTypeLiteral";
  NodeBuilderFlags[NodeBuilderFlags["InTypeAlias"] = 8388608] = "InTypeAlias";
  NodeBuilderFlags[NodeBuilderFlags["InInitialEntityName"] = 16777216] = "InInitialEntityName";
})(NodeBuilderFlags || (NodeBuilderFlags = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/objectFlags.js
var ObjectFlags;
(function(ObjectFlags) {
  ObjectFlags[ObjectFlags["None"] = 0] = "None";
  ObjectFlags[ObjectFlags["Class"] = 1] = "Class";
  ObjectFlags[ObjectFlags["Interface"] = 2] = "Interface";
  ObjectFlags[ObjectFlags["Reference"] = 4] = "Reference";
  ObjectFlags[ObjectFlags["Tuple"] = 8] = "Tuple";
  ObjectFlags[ObjectFlags["Anonymous"] = 16] = "Anonymous";
  ObjectFlags[ObjectFlags["Mapped"] = 32] = "Mapped";
  ObjectFlags[ObjectFlags["Instantiated"] = 64] = "Instantiated";
  ObjectFlags[ObjectFlags["ObjectLiteral"] = 128] = "ObjectLiteral";
  ObjectFlags[ObjectFlags["EvolvingArray"] = 256] = "EvolvingArray";
  ObjectFlags[ObjectFlags["ObjectLiteralPatternWithComputedProperties"] = 512] = "ObjectLiteralPatternWithComputedProperties";
  ObjectFlags[ObjectFlags["ReverseMapped"] = 1024] = "ReverseMapped";
  ObjectFlags[ObjectFlags["JsxAttributes"] = 2048] = "JsxAttributes";
  ObjectFlags[ObjectFlags["JSLiteral"] = 4096] = "JSLiteral";
  ObjectFlags[ObjectFlags["FreshLiteral"] = 8192] = "FreshLiteral";
  ObjectFlags[ObjectFlags["ArrayLiteral"] = 16384] = "ArrayLiteral";
  ObjectFlags[ObjectFlags["PrimitiveUnion"] = 32768] = "PrimitiveUnion";
  ObjectFlags[ObjectFlags["ContainsWideningType"] = 65536] = "ContainsWideningType";
  ObjectFlags[ObjectFlags["ContainsObjectOrArrayLiteral"] = 131072] = "ContainsObjectOrArrayLiteral";
  ObjectFlags[ObjectFlags["NonInferrableType"] = 262144] = "NonInferrableType";
  ObjectFlags[ObjectFlags["CouldContainTypeVariablesComputed"] = 524288] = "CouldContainTypeVariablesComputed";
  ObjectFlags[ObjectFlags["CouldContainTypeVariables"] = 1048576] = "CouldContainTypeVariables";
  ObjectFlags[ObjectFlags["MembersResolved"] = 2097152] = "MembersResolved";
  ObjectFlags[ObjectFlags["ClassOrInterface"] = 3] = "ClassOrInterface";
  ObjectFlags[ObjectFlags["RequiresWidening"] = 196608] = "RequiresWidening";
  ObjectFlags[ObjectFlags["PropagatingFlags"] = 458752] = "PropagatingFlags";
  ObjectFlags[ObjectFlags["InstantiatedMapped"] = 96] = "InstantiatedMapped";
  ObjectFlags[ObjectFlags["InstantiationExpressionType"] = 16777216] = "InstantiationExpressionType";
  ObjectFlags[ObjectFlags["SingleSignatureType"] = 33554432] = "SingleSignatureType";
  ObjectFlags[ObjectFlags["ObjectTypeKindMask"] = 50332991] = "ObjectTypeKindMask";
  ObjectFlags[ObjectFlags["ContainsSpread"] = 4194304] = "ContainsSpread";
  ObjectFlags[ObjectFlags["ObjectRestType"] = 8388608] = "ObjectRestType";
  ObjectFlags[ObjectFlags["IsClassInstanceClone"] = 67108864] = "IsClassInstanceClone";
  ObjectFlags[ObjectFlags["IdenticalBaseTypeCalculated"] = 134217728] = "IdenticalBaseTypeCalculated";
  ObjectFlags[ObjectFlags["IdenticalBaseTypeExists"] = 268435456] = "IdenticalBaseTypeExists";
  ObjectFlags[ObjectFlags["UnresolvedMembers"] = 536870912] = "UnresolvedMembers";
  ObjectFlags[ObjectFlags["FromTypeNode"] = 1073741824] = "FromTypeNode";
  ObjectFlags[ObjectFlags["IsGenericTypeComputed"] = 4194304] = "IsGenericTypeComputed";
  ObjectFlags[ObjectFlags["IsGenericObjectType"] = 8388608] = "IsGenericObjectType";
  ObjectFlags[ObjectFlags["IsGenericIndexType"] = 16777216] = "IsGenericIndexType";
  ObjectFlags[ObjectFlags["IsGenericType"] = 25165824] = "IsGenericType";
  ObjectFlags[ObjectFlags["ContainsIntersections"] = 33554432] = "ContainsIntersections";
  ObjectFlags[ObjectFlags["IsUnknownLikeUnionComputed"] = 67108864] = "IsUnknownLikeUnionComputed";
  ObjectFlags[ObjectFlags["IsUnknownLikeUnion"] = 134217728] = "IsUnknownLikeUnion";
  ObjectFlags[ObjectFlags["IsNeverIntersectionComputed"] = 33554432] = "IsNeverIntersectionComputed";
  ObjectFlags[ObjectFlags["IsNeverIntersection"] = 67108864] = "IsNeverIntersection";
  ObjectFlags[ObjectFlags["IsConstrainedTypeVariable"] = 134217728] = "IsConstrainedTypeVariable";
})(ObjectFlags || (ObjectFlags = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/signatureFlags.js
var SignatureFlags;
(function(SignatureFlags) {
  SignatureFlags[SignatureFlags["None"] = 0] = "None";
  SignatureFlags[SignatureFlags["HasRestParameter"] = 1] = "HasRestParameter";
  SignatureFlags[SignatureFlags["HasLiteralTypes"] = 2] = "HasLiteralTypes";
  SignatureFlags[SignatureFlags["Construct"] = 4] = "Construct";
  SignatureFlags[SignatureFlags["Abstract"] = 8] = "Abstract";
  SignatureFlags[SignatureFlags["IsInnerCallChain"] = 16] = "IsInnerCallChain";
  SignatureFlags[SignatureFlags["IsOuterCallChain"] = 32] = "IsOuterCallChain";
  SignatureFlags[SignatureFlags["IsUntypedSignatureInJSFile"] = 64] = "IsUntypedSignatureInJSFile";
  SignatureFlags[SignatureFlags["IsNonInferrable"] = 128] = "IsNonInferrable";
  SignatureFlags[SignatureFlags["IsSignatureCandidateForOverloadFailure"] = 256] = "IsSignatureCandidateForOverloadFailure";
  SignatureFlags[SignatureFlags["PropagatingFlags"] = 335] = "PropagatingFlags";
  SignatureFlags[SignatureFlags["CallChainFlags"] = 48] = "CallChainFlags";
})(SignatureFlags || (SignatureFlags = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/signatureKind.js
var SignatureKind;
(function(SignatureKind) {
  SignatureKind[SignatureKind["Call"] = 0] = "Call";
  SignatureKind[SignatureKind["Construct"] = 1] = "Construct";
})(SignatureKind || (SignatureKind = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/symbolFlags.js
var SymbolFlags;
(function(SymbolFlags) {
  SymbolFlags[SymbolFlags["None"] = 0] = "None";
  SymbolFlags[SymbolFlags["FunctionScopedVariable"] = 1] = "FunctionScopedVariable";
  SymbolFlags[SymbolFlags["BlockScopedVariable"] = 2] = "BlockScopedVariable";
  SymbolFlags[SymbolFlags["Property"] = 4] = "Property";
  SymbolFlags[SymbolFlags["EnumMember"] = 8] = "EnumMember";
  SymbolFlags[SymbolFlags["Function"] = 16] = "Function";
  SymbolFlags[SymbolFlags["Class"] = 32] = "Class";
  SymbolFlags[SymbolFlags["Interface"] = 64] = "Interface";
  SymbolFlags[SymbolFlags["ConstEnum"] = 128] = "ConstEnum";
  SymbolFlags[SymbolFlags["RegularEnum"] = 256] = "RegularEnum";
  SymbolFlags[SymbolFlags["ValueModule"] = 512] = "ValueModule";
  SymbolFlags[SymbolFlags["NamespaceModule"] = 1024] = "NamespaceModule";
  SymbolFlags[SymbolFlags["TypeLiteral"] = 2048] = "TypeLiteral";
  SymbolFlags[SymbolFlags["ObjectLiteral"] = 4096] = "ObjectLiteral";
  SymbolFlags[SymbolFlags["Method"] = 8192] = "Method";
  SymbolFlags[SymbolFlags["Constructor"] = 16384] = "Constructor";
  SymbolFlags[SymbolFlags["GetAccessor"] = 32768] = "GetAccessor";
  SymbolFlags[SymbolFlags["SetAccessor"] = 65536] = "SetAccessor";
  SymbolFlags[SymbolFlags["Signature"] = 131072] = "Signature";
  SymbolFlags[SymbolFlags["TypeParameter"] = 262144] = "TypeParameter";
  SymbolFlags[SymbolFlags["TypeAlias"] = 524288] = "TypeAlias";
  SymbolFlags[SymbolFlags["ExportValue"] = 1048576] = "ExportValue";
  SymbolFlags[SymbolFlags["Alias"] = 2097152] = "Alias";
  SymbolFlags[SymbolFlags["Prototype"] = 4194304] = "Prototype";
  SymbolFlags[SymbolFlags["ExportStar"] = 8388608] = "ExportStar";
  SymbolFlags[SymbolFlags["Optional"] = 16777216] = "Optional";
  SymbolFlags[SymbolFlags["Transient"] = 33554432] = "Transient";
  SymbolFlags[SymbolFlags["Assignment"] = 67108864] = "Assignment";
  SymbolFlags[SymbolFlags["ModuleExports"] = 134217728] = "ModuleExports";
  SymbolFlags[SymbolFlags["ConstEnumOnlyModule"] = 268435456] = "ConstEnumOnlyModule";
  SymbolFlags[SymbolFlags["ReplaceableByMethod"] = 536870912] = "ReplaceableByMethod";
  SymbolFlags[SymbolFlags["GlobalLookup"] = 1073741824] = "GlobalLookup";
  SymbolFlags[SymbolFlags["All"] = 536870912] = "All";
  SymbolFlags[SymbolFlags["Enum"] = 384] = "Enum";
  SymbolFlags[SymbolFlags["Variable"] = 3] = "Variable";
  SymbolFlags[SymbolFlags["Value"] = 111551] = "Value";
  SymbolFlags[SymbolFlags["Type"] = 788968] = "Type";
  SymbolFlags[SymbolFlags["Namespace"] = 1920] = "Namespace";
  SymbolFlags[SymbolFlags["Module"] = 1536] = "Module";
  SymbolFlags[SymbolFlags["Accessor"] = 98304] = "Accessor";
  SymbolFlags[SymbolFlags["FunctionScopedVariableExcludes"] = 111550] = "FunctionScopedVariableExcludes";
  SymbolFlags[SymbolFlags["BlockScopedVariableExcludes"] = 111551] = "BlockScopedVariableExcludes";
  SymbolFlags[SymbolFlags["ParameterExcludes"] = 111551] = "ParameterExcludes";
  SymbolFlags[SymbolFlags["PropertyExcludes"] = 13243] = "PropertyExcludes";
  SymbolFlags[SymbolFlags["EnumMemberExcludes"] = 900095] = "EnumMemberExcludes";
  SymbolFlags[SymbolFlags["FunctionExcludes"] = 110991] = "FunctionExcludes";
  SymbolFlags[SymbolFlags["ClassExcludes"] = 899503] = "ClassExcludes";
  SymbolFlags[SymbolFlags["InterfaceExcludes"] = 788872] = "InterfaceExcludes";
  SymbolFlags[SymbolFlags["RegularEnumExcludes"] = 899327] = "RegularEnumExcludes";
  SymbolFlags[SymbolFlags["ConstEnumExcludes"] = 899967] = "ConstEnumExcludes";
  SymbolFlags[SymbolFlags["ValueModuleExcludes"] = 110735] = "ValueModuleExcludes";
  SymbolFlags[SymbolFlags["NamespaceModuleExcludes"] = 0] = "NamespaceModuleExcludes";
  SymbolFlags[SymbolFlags["MethodExcludes"] = 103359] = "MethodExcludes";
  SymbolFlags[SymbolFlags["GetAccessorExcludes"] = 46011] = "GetAccessorExcludes";
  SymbolFlags[SymbolFlags["SetAccessorExcludes"] = 78779] = "SetAccessorExcludes";
  SymbolFlags[SymbolFlags["AccessorExcludes"] = 111547] = "AccessorExcludes";
  SymbolFlags[SymbolFlags["TypeParameterExcludes"] = 526824] = "TypeParameterExcludes";
  SymbolFlags[SymbolFlags["TypeAliasExcludes"] = 788968] = "TypeAliasExcludes";
  SymbolFlags[SymbolFlags["AliasExcludes"] = 2097152] = "AliasExcludes";
  SymbolFlags[SymbolFlags["ModuleMember"] = 2623475] = "ModuleMember";
  SymbolFlags[SymbolFlags["ExportHasLocal"] = 944] = "ExportHasLocal";
  SymbolFlags[SymbolFlags["BlockScoped"] = 418] = "BlockScoped";
  SymbolFlags[SymbolFlags["PropertyOrAccessor"] = 98308] = "PropertyOrAccessor";
  SymbolFlags[SymbolFlags["ClassMember"] = 106500] = "ClassMember";
  SymbolFlags[SymbolFlags["ExportSupportsDefaultModifier"] = 112] = "ExportSupportsDefaultModifier";
  SymbolFlags[SymbolFlags["ExportDoesNotSupportDefaultModifier"] = -113] = "ExportDoesNotSupportDefaultModifier";
  SymbolFlags[SymbolFlags["Classifiable"] = 2885600] = "Classifiable";
  SymbolFlags[SymbolFlags["LateBindingContainer"] = 6256] = "LateBindingContainer";
})(SymbolFlags || (SymbolFlags = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/typeFlags.js
var TypeFlags;
(function(TypeFlags) {
  TypeFlags[TypeFlags["None"] = 0] = "None";
  TypeFlags[TypeFlags["Any"] = 1] = "Any";
  TypeFlags[TypeFlags["Unknown"] = 2] = "Unknown";
  TypeFlags[TypeFlags["Undefined"] = 4] = "Undefined";
  TypeFlags[TypeFlags["Null"] = 8] = "Null";
  TypeFlags[TypeFlags["Void"] = 16] = "Void";
  TypeFlags[TypeFlags["String"] = 32] = "String";
  TypeFlags[TypeFlags["Number"] = 64] = "Number";
  TypeFlags[TypeFlags["BigInt"] = 128] = "BigInt";
  TypeFlags[TypeFlags["Boolean"] = 256] = "Boolean";
  TypeFlags[TypeFlags["ESSymbol"] = 512] = "ESSymbol";
  TypeFlags[TypeFlags["StringLiteral"] = 1024] = "StringLiteral";
  TypeFlags[TypeFlags["NumberLiteral"] = 2048] = "NumberLiteral";
  TypeFlags[TypeFlags["BigIntLiteral"] = 4096] = "BigIntLiteral";
  TypeFlags[TypeFlags["BooleanLiteral"] = 8192] = "BooleanLiteral";
  TypeFlags[TypeFlags["UniqueESSymbol"] = 16384] = "UniqueESSymbol";
  TypeFlags[TypeFlags["EnumLiteral"] = 32768] = "EnumLiteral";
  TypeFlags[TypeFlags["Enum"] = 65536] = "Enum";
  TypeFlags[TypeFlags["NonPrimitive"] = 131072] = "NonPrimitive";
  TypeFlags[TypeFlags["Never"] = 262144] = "Never";
  TypeFlags[TypeFlags["TypeParameter"] = 524288] = "TypeParameter";
  TypeFlags[TypeFlags["Object"] = 1048576] = "Object";
  TypeFlags[TypeFlags["Index"] = 2097152] = "Index";
  TypeFlags[TypeFlags["TemplateLiteral"] = 4194304] = "TemplateLiteral";
  TypeFlags[TypeFlags["StringMapping"] = 8388608] = "StringMapping";
  TypeFlags[TypeFlags["Substitution"] = 16777216] = "Substitution";
  TypeFlags[TypeFlags["IndexedAccess"] = 33554432] = "IndexedAccess";
  TypeFlags[TypeFlags["Conditional"] = 67108864] = "Conditional";
  TypeFlags[TypeFlags["Union"] = 134217728] = "Union";
  TypeFlags[TypeFlags["Intersection"] = 268435456] = "Intersection";
  TypeFlags[TypeFlags["Reserved1"] = 536870912] = "Reserved1";
  TypeFlags[TypeFlags["Reserved2"] = 1073741824] = "Reserved2";
  TypeFlags[TypeFlags["Reserved3"] = -2147483648] = "Reserved3";
  TypeFlags[TypeFlags["AnyOrUnknown"] = 3] = "AnyOrUnknown";
  TypeFlags[TypeFlags["Nullable"] = 12] = "Nullable";
  TypeFlags[TypeFlags["Literal"] = 15360] = "Literal";
  TypeFlags[TypeFlags["Unit"] = 97292] = "Unit";
  TypeFlags[TypeFlags["Freshable"] = 80896] = "Freshable";
  TypeFlags[TypeFlags["StringOrNumberLiteral"] = 3072] = "StringOrNumberLiteral";
  TypeFlags[TypeFlags["StringOrNumberLiteralOrUnique"] = 19456] = "StringOrNumberLiteralOrUnique";
  TypeFlags[TypeFlags["DefinitelyFalsy"] = 15388] = "DefinitelyFalsy";
  TypeFlags[TypeFlags["PossiblyFalsy"] = 15868] = "PossiblyFalsy";
  TypeFlags[TypeFlags["Intrinsic"] = 393983] = "Intrinsic";
  TypeFlags[TypeFlags["StringLike"] = 12583968] = "StringLike";
  TypeFlags[TypeFlags["NumberLike"] = 67648] = "NumberLike";
  TypeFlags[TypeFlags["BigIntLike"] = 4224] = "BigIntLike";
  TypeFlags[TypeFlags["BooleanLike"] = 8448] = "BooleanLike";
  TypeFlags[TypeFlags["EnumLike"] = 98304] = "EnumLike";
  TypeFlags[TypeFlags["ESSymbolLike"] = 16896] = "ESSymbolLike";
  TypeFlags[TypeFlags["VoidLike"] = 20] = "VoidLike";
  TypeFlags[TypeFlags["Primitive"] = 12713980] = "Primitive";
  TypeFlags[TypeFlags["DefinitelyNonNullable"] = 13893600] = "DefinitelyNonNullable";
  TypeFlags[TypeFlags["DisjointDomains"] = 12812284] = "DisjointDomains";
  TypeFlags[TypeFlags["UnionOrIntersection"] = 402653184] = "UnionOrIntersection";
  TypeFlags[TypeFlags["StructuredType"] = 403701760] = "StructuredType";
  TypeFlags[TypeFlags["TypeVariable"] = 34078720] = "TypeVariable";
  TypeFlags[TypeFlags["InstantiableNonPrimitive"] = 117964800] = "InstantiableNonPrimitive";
  TypeFlags[TypeFlags["InstantiablePrimitive"] = 14680064] = "InstantiablePrimitive";
  TypeFlags[TypeFlags["Instantiable"] = 132644864] = "Instantiable";
  TypeFlags[TypeFlags["StructuredOrInstantiable"] = 536346624] = "StructuredOrInstantiable";
  TypeFlags[TypeFlags["ObjectFlagsType"] = 403963917] = "ObjectFlagsType";
  TypeFlags[TypeFlags["Simplifiable"] = 102760448] = "Simplifiable";
  TypeFlags[TypeFlags["Singleton"] = 394239] = "Singleton";
  TypeFlags[TypeFlags["Narrowable"] = 536575971] = "Narrowable";
  TypeFlags[TypeFlags["IncludesMask"] = 416808959] = "IncludesMask";
  TypeFlags[TypeFlags["IncludesMissingType"] = 524288] = "IncludesMissingType";
  TypeFlags[TypeFlags["IncludesNonWideningType"] = 2097152] = "IncludesNonWideningType";
  TypeFlags[TypeFlags["IncludesWildcard"] = 33554432] = "IncludesWildcard";
  TypeFlags[TypeFlags["IncludesEmptyObject"] = 67108864] = "IncludesEmptyObject";
  TypeFlags[TypeFlags["IncludesInstantiable"] = 16777216] = "IncludesInstantiable";
  TypeFlags[TypeFlags["IncludesConstrainedTypeVariable"] = 536870912] = "IncludesConstrainedTypeVariable";
  TypeFlags[TypeFlags["IncludesError"] = 1073741824] = "IncludesError";
  TypeFlags[TypeFlags["NotPrimitiveUnion"] = 286523411] = "NotPrimitiveUnion";
})(TypeFlags || (TypeFlags = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/typePredicateKind.js
var TypePredicateKind;
(function(TypePredicateKind) {
  TypePredicateKind[TypePredicateKind["This"] = 0] = "This";
  TypePredicateKind[TypePredicateKind["Identifier"] = 1] = "Identifier";
  TypePredicateKind[TypePredicateKind["AssertsThis"] = 2] = "AssertsThis";
  TypePredicateKind[TypePredicateKind["AssertsIdentifier"] = 3] = "AssertsIdentifier";
})(TypePredicateKind || (TypePredicateKind = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/characterCodes.js
var CharacterCodes;
(function(CharacterCodes) {
  CharacterCodes[CharacterCodes["EOF"] = -1] = "EOF";
  CharacterCodes[CharacterCodes["nullCharacter"] = 0] = "nullCharacter";
  CharacterCodes[CharacterCodes["maxAsciiCharacter"] = 127] = "maxAsciiCharacter";
  CharacterCodes[CharacterCodes["lineFeed"] = 10] = "lineFeed";
  CharacterCodes[CharacterCodes["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes[CharacterCodes["lineSeparator"] = 8232] = "lineSeparator";
  CharacterCodes[CharacterCodes["paragraphSeparator"] = 8233] = "paragraphSeparator";
  CharacterCodes[CharacterCodes["nextLine"] = 133] = "nextLine";
  CharacterCodes[CharacterCodes["space"] = 32] = "space";
  CharacterCodes[CharacterCodes["nonBreakingSpace"] = 160] = "nonBreakingSpace";
  CharacterCodes[CharacterCodes["enQuad"] = 8192] = "enQuad";
  CharacterCodes[CharacterCodes["emQuad"] = 8193] = "emQuad";
  CharacterCodes[CharacterCodes["enSpace"] = 8194] = "enSpace";
  CharacterCodes[CharacterCodes["emSpace"] = 8195] = "emSpace";
  CharacterCodes[CharacterCodes["threePerEmSpace"] = 8196] = "threePerEmSpace";
  CharacterCodes[CharacterCodes["fourPerEmSpace"] = 8197] = "fourPerEmSpace";
  CharacterCodes[CharacterCodes["sixPerEmSpace"] = 8198] = "sixPerEmSpace";
  CharacterCodes[CharacterCodes["figureSpace"] = 8199] = "figureSpace";
  CharacterCodes[CharacterCodes["punctuationSpace"] = 8200] = "punctuationSpace";
  CharacterCodes[CharacterCodes["thinSpace"] = 8201] = "thinSpace";
  CharacterCodes[CharacterCodes["hairSpace"] = 8202] = "hairSpace";
  CharacterCodes[CharacterCodes["zeroWidthSpace"] = 8203] = "zeroWidthSpace";
  CharacterCodes[CharacterCodes["narrowNoBreakSpace"] = 8239] = "narrowNoBreakSpace";
  CharacterCodes[CharacterCodes["ideographicSpace"] = 12288] = "ideographicSpace";
  CharacterCodes[CharacterCodes["mathematicalSpace"] = 8287] = "mathematicalSpace";
  CharacterCodes[CharacterCodes["ogham"] = 5765] = "ogham";
  CharacterCodes[CharacterCodes["replacementCharacter"] = 65533] = "replacementCharacter";
  CharacterCodes[CharacterCodes["_"] = 95] = "_";
  CharacterCodes[CharacterCodes["$"] = 36] = "$";
  CharacterCodes[CharacterCodes["_0"] = 48] = "_0";
  CharacterCodes[CharacterCodes["_1"] = 49] = "_1";
  CharacterCodes[CharacterCodes["_2"] = 50] = "_2";
  CharacterCodes[CharacterCodes["_3"] = 51] = "_3";
  CharacterCodes[CharacterCodes["_4"] = 52] = "_4";
  CharacterCodes[CharacterCodes["_5"] = 53] = "_5";
  CharacterCodes[CharacterCodes["_6"] = 54] = "_6";
  CharacterCodes[CharacterCodes["_7"] = 55] = "_7";
  CharacterCodes[CharacterCodes["_8"] = 56] = "_8";
  CharacterCodes[CharacterCodes["_9"] = 57] = "_9";
  CharacterCodes[CharacterCodes["a"] = 97] = "a";
  CharacterCodes[CharacterCodes["b"] = 98] = "b";
  CharacterCodes[CharacterCodes["c"] = 99] = "c";
  CharacterCodes[CharacterCodes["d"] = 100] = "d";
  CharacterCodes[CharacterCodes["e"] = 101] = "e";
  CharacterCodes[CharacterCodes["f"] = 102] = "f";
  CharacterCodes[CharacterCodes["g"] = 103] = "g";
  CharacterCodes[CharacterCodes["h"] = 104] = "h";
  CharacterCodes[CharacterCodes["i"] = 105] = "i";
  CharacterCodes[CharacterCodes["j"] = 106] = "j";
  CharacterCodes[CharacterCodes["k"] = 107] = "k";
  CharacterCodes[CharacterCodes["l"] = 108] = "l";
  CharacterCodes[CharacterCodes["m"] = 109] = "m";
  CharacterCodes[CharacterCodes["n"] = 110] = "n";
  CharacterCodes[CharacterCodes["o"] = 111] = "o";
  CharacterCodes[CharacterCodes["p"] = 112] = "p";
  CharacterCodes[CharacterCodes["q"] = 113] = "q";
  CharacterCodes[CharacterCodes["r"] = 114] = "r";
  CharacterCodes[CharacterCodes["s"] = 115] = "s";
  CharacterCodes[CharacterCodes["t"] = 116] = "t";
  CharacterCodes[CharacterCodes["u"] = 117] = "u";
  CharacterCodes[CharacterCodes["v"] = 118] = "v";
  CharacterCodes[CharacterCodes["w"] = 119] = "w";
  CharacterCodes[CharacterCodes["x"] = 120] = "x";
  CharacterCodes[CharacterCodes["y"] = 121] = "y";
  CharacterCodes[CharacterCodes["z"] = 122] = "z";
  CharacterCodes[CharacterCodes["A"] = 65] = "A";
  CharacterCodes[CharacterCodes["B"] = 66] = "B";
  CharacterCodes[CharacterCodes["C"] = 67] = "C";
  CharacterCodes[CharacterCodes["D"] = 68] = "D";
  CharacterCodes[CharacterCodes["E"] = 69] = "E";
  CharacterCodes[CharacterCodes["F"] = 70] = "F";
  CharacterCodes[CharacterCodes["G"] = 71] = "G";
  CharacterCodes[CharacterCodes["H"] = 72] = "H";
  CharacterCodes[CharacterCodes["I"] = 73] = "I";
  CharacterCodes[CharacterCodes["J"] = 74] = "J";
  CharacterCodes[CharacterCodes["K"] = 75] = "K";
  CharacterCodes[CharacterCodes["L"] = 76] = "L";
  CharacterCodes[CharacterCodes["M"] = 77] = "M";
  CharacterCodes[CharacterCodes["N"] = 78] = "N";
  CharacterCodes[CharacterCodes["O"] = 79] = "O";
  CharacterCodes[CharacterCodes["P"] = 80] = "P";
  CharacterCodes[CharacterCodes["Q"] = 81] = "Q";
  CharacterCodes[CharacterCodes["R"] = 82] = "R";
  CharacterCodes[CharacterCodes["S"] = 83] = "S";
  CharacterCodes[CharacterCodes["T"] = 84] = "T";
  CharacterCodes[CharacterCodes["U"] = 85] = "U";
  CharacterCodes[CharacterCodes["V"] = 86] = "V";
  CharacterCodes[CharacterCodes["W"] = 87] = "W";
  CharacterCodes[CharacterCodes["X"] = 88] = "X";
  CharacterCodes[CharacterCodes["Y"] = 89] = "Y";
  CharacterCodes[CharacterCodes["Z"] = 90] = "Z";
  CharacterCodes[CharacterCodes["ampersand"] = 38] = "ampersand";
  CharacterCodes[CharacterCodes["asterisk"] = 42] = "asterisk";
  CharacterCodes[CharacterCodes["at"] = 64] = "at";
  CharacterCodes[CharacterCodes["backslash"] = 92] = "backslash";
  CharacterCodes[CharacterCodes["backtick"] = 96] = "backtick";
  CharacterCodes[CharacterCodes["bar"] = 124] = "bar";
  CharacterCodes[CharacterCodes["caret"] = 94] = "caret";
  CharacterCodes[CharacterCodes["closeBrace"] = 125] = "closeBrace";
  CharacterCodes[CharacterCodes["closeBracket"] = 93] = "closeBracket";
  CharacterCodes[CharacterCodes["closeParen"] = 41] = "closeParen";
  CharacterCodes[CharacterCodes["colon"] = 58] = "colon";
  CharacterCodes[CharacterCodes["comma"] = 44] = "comma";
  CharacterCodes[CharacterCodes["dot"] = 46] = "dot";
  CharacterCodes[CharacterCodes["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes[CharacterCodes["equals"] = 61] = "equals";
  CharacterCodes[CharacterCodes["exclamation"] = 33] = "exclamation";
  CharacterCodes[CharacterCodes["greaterThan"] = 62] = "greaterThan";
  CharacterCodes[CharacterCodes["hash"] = 35] = "hash";
  CharacterCodes[CharacterCodes["lessThan"] = 60] = "lessThan";
  CharacterCodes[CharacterCodes["minus"] = 45] = "minus";
  CharacterCodes[CharacterCodes["openBrace"] = 123] = "openBrace";
  CharacterCodes[CharacterCodes["openBracket"] = 91] = "openBracket";
  CharacterCodes[CharacterCodes["openParen"] = 40] = "openParen";
  CharacterCodes[CharacterCodes["percent"] = 37] = "percent";
  CharacterCodes[CharacterCodes["plus"] = 43] = "plus";
  CharacterCodes[CharacterCodes["question"] = 63] = "question";
  CharacterCodes[CharacterCodes["semicolon"] = 59] = "semicolon";
  CharacterCodes[CharacterCodes["singleQuote"] = 39] = "singleQuote";
  CharacterCodes[CharacterCodes["slash"] = 47] = "slash";
  CharacterCodes[CharacterCodes["tilde"] = 126] = "tilde";
  CharacterCodes[CharacterCodes["backspace"] = 8] = "backspace";
  CharacterCodes[CharacterCodes["formFeed"] = 12] = "formFeed";
  CharacterCodes[CharacterCodes["byteOrderMark"] = 65279] = "byteOrderMark";
  CharacterCodes[CharacterCodes["tab"] = 9] = "tab";
  CharacterCodes[CharacterCodes["verticalTab"] = 11] = "verticalTab";
})(CharacterCodes || (CharacterCodes = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/commentDirectiveType.js
var CommentDirectiveType;
(function(CommentDirectiveType) {
  CommentDirectiveType[CommentDirectiveType["ExpectError"] = 0] = "ExpectError";
  CommentDirectiveType[CommentDirectiveType["Ignore"] = 1] = "Ignore";
})(CommentDirectiveType || (CommentDirectiveType = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/internalSymbolName.js
var InternalSymbolName;
(function(InternalSymbolName) {
  InternalSymbolName["Call"] = "__call";
  InternalSymbolName["Constructor"] = "__constructor";
  InternalSymbolName["New"] = "__new";
  InternalSymbolName["Index"] = "__index";
  InternalSymbolName["ExportStar"] = "__export";
  InternalSymbolName["Global"] = "__global";
  InternalSymbolName["Missing"] = "__missing";
  InternalSymbolName["Type"] = "__type";
  InternalSymbolName["Object"] = "__object";
  InternalSymbolName["JSXAttributes"] = "__jsxAttributes";
  InternalSymbolName["Class"] = "__class";
  InternalSymbolName["Function"] = "__function";
  InternalSymbolName["Computed"] = "__computed";
  InternalSymbolName["AssignmentDeclaration"] = "__assignment";
  InternalSymbolName["InstantiationExpression"] = "__instantiationExpression";
  InternalSymbolName["ImportAttributes"] = "__importAttributes";
  InternalSymbolName["ExportEquals"] = "export=";
  InternalSymbolName["Default"] = "default";
  InternalSymbolName["This"] = "this";
  InternalSymbolName["ModuleExports"] = "module.exports";
})(InternalSymbolName || (InternalSymbolName = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/languageVariant.js
var LanguageVariant;
(function(LanguageVariant) {
  LanguageVariant[LanguageVariant["Standard"] = 0] = "Standard";
  LanguageVariant[LanguageVariant["JSX"] = 1] = "JSX";
})(LanguageVariant || (LanguageVariant = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/modifierFlags.js
var ModifierFlags;
(function(ModifierFlags) {
  ModifierFlags[ModifierFlags["None"] = 0] = "None";
  ModifierFlags[ModifierFlags["Public"] = 1] = "Public";
  ModifierFlags[ModifierFlags["Private"] = 2] = "Private";
  ModifierFlags[ModifierFlags["Protected"] = 4] = "Protected";
  ModifierFlags[ModifierFlags["Readonly"] = 8] = "Readonly";
  ModifierFlags[ModifierFlags["Override"] = 16] = "Override";
  ModifierFlags[ModifierFlags["Export"] = 32] = "Export";
  ModifierFlags[ModifierFlags["Abstract"] = 64] = "Abstract";
  ModifierFlags[ModifierFlags["Ambient"] = 128] = "Ambient";
  ModifierFlags[ModifierFlags["Static"] = 256] = "Static";
  ModifierFlags[ModifierFlags["Accessor"] = 512] = "Accessor";
  ModifierFlags[ModifierFlags["Async"] = 1024] = "Async";
  ModifierFlags[ModifierFlags["Default"] = 2048] = "Default";
  ModifierFlags[ModifierFlags["Const"] = 4096] = "Const";
  ModifierFlags[ModifierFlags["In"] = 8192] = "In";
  ModifierFlags[ModifierFlags["Out"] = 16384] = "Out";
  ModifierFlags[ModifierFlags["Decorator"] = 32768] = "Decorator";
  ModifierFlags[ModifierFlags["Deprecated"] = 65536] = "Deprecated";
  ModifierFlags[ModifierFlags["JSDocPublic"] = 8388608] = "JSDocPublic";
  ModifierFlags[ModifierFlags["JSDocPrivate"] = 16777216] = "JSDocPrivate";
  ModifierFlags[ModifierFlags["JSDocProtected"] = 33554432] = "JSDocProtected";
  ModifierFlags[ModifierFlags["JSDocReadonly"] = 67108864] = "JSDocReadonly";
  ModifierFlags[ModifierFlags["JSDocOverride"] = 134217728] = "JSDocOverride";
  ModifierFlags[ModifierFlags["HasComputedJSDocModifiers"] = 268435456] = "HasComputedJSDocModifiers";
  ModifierFlags[ModifierFlags["HasComputedFlags"] = 536870912] = "HasComputedFlags";
  ModifierFlags[ModifierFlags["SyntacticOrJSDocModifiers"] = 31] = "SyntacticOrJSDocModifiers";
  ModifierFlags[ModifierFlags["SyntacticOnlyModifiers"] = 65504] = "SyntacticOnlyModifiers";
  ModifierFlags[ModifierFlags["SyntacticModifiers"] = 65535] = "SyntacticModifiers";
  ModifierFlags[ModifierFlags["JSDocCacheOnlyModifiers"] = 260046848] = "JSDocCacheOnlyModifiers";
  ModifierFlags[ModifierFlags["JSDocOnlyModifiers"] = 65536] = "JSDocOnlyModifiers";
  ModifierFlags[ModifierFlags["NonCacheOnlyModifiers"] = 131071] = "NonCacheOnlyModifiers";
  ModifierFlags[ModifierFlags["AccessibilityModifier"] = 7] = "AccessibilityModifier";
  ModifierFlags[ModifierFlags["ParameterPropertyModifier"] = 31] = "ParameterPropertyModifier";
  ModifierFlags[ModifierFlags["NonPublicAccessibilityModifier"] = 6] = "NonPublicAccessibilityModifier";
  ModifierFlags[ModifierFlags["TypeScriptModifier"] = 28895] = "TypeScriptModifier";
  ModifierFlags[ModifierFlags["ExportDefault"] = 2080] = "ExportDefault";
  ModifierFlags[ModifierFlags["All"] = 131071] = "All";
  ModifierFlags[ModifierFlags["Modifier"] = 98303] = "Modifier";
  ModifierFlags[ModifierFlags["JavaScript"] = 3872] = "JavaScript";
})(ModifierFlags || (ModifierFlags = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/nodeFlags.js
var NodeFlags;
(function(NodeFlags) {
  NodeFlags[NodeFlags["None"] = 0] = "None";
  NodeFlags[NodeFlags["Let"] = 1] = "Let";
  NodeFlags[NodeFlags["Const"] = 2] = "Const";
  NodeFlags[NodeFlags["Using"] = 4] = "Using";
  NodeFlags[NodeFlags["Reparsed"] = 8] = "Reparsed";
  NodeFlags[NodeFlags["Synthesized"] = 16] = "Synthesized";
  NodeFlags[NodeFlags["OptionalChain"] = 32] = "OptionalChain";
  NodeFlags[NodeFlags["ExportContext"] = 64] = "ExportContext";
  NodeFlags[NodeFlags["ContainsThis"] = 128] = "ContainsThis";
  NodeFlags[NodeFlags["HasImplicitReturn"] = 256] = "HasImplicitReturn";
  NodeFlags[NodeFlags["HasExplicitReturn"] = 512] = "HasExplicitReturn";
  NodeFlags[NodeFlags["DisallowInContext"] = 1024] = "DisallowInContext";
  NodeFlags[NodeFlags["YieldContext"] = 2048] = "YieldContext";
  NodeFlags[NodeFlags["DecoratorContext"] = 4096] = "DecoratorContext";
  NodeFlags[NodeFlags["AwaitContext"] = 8192] = "AwaitContext";
  NodeFlags[NodeFlags["DisallowConditionalTypesContext"] = 16384] = "DisallowConditionalTypesContext";
  NodeFlags[NodeFlags["ThisNodeHasError"] = 32768] = "ThisNodeHasError";
  NodeFlags[NodeFlags["JavaScriptFile"] = 65536] = "JavaScriptFile";
  NodeFlags[NodeFlags["ThisNodeOrAnySubNodesHasError"] = 131072] = "ThisNodeOrAnySubNodesHasError";
  NodeFlags[NodeFlags["HasAsyncFunctions"] = 262144] = "HasAsyncFunctions";
  NodeFlags[NodeFlags["PossiblyContainsDynamicImport"] = 524288] = "PossiblyContainsDynamicImport";
  NodeFlags[NodeFlags["PossiblyContainsImportMeta"] = 1048576] = "PossiblyContainsImportMeta";
  NodeFlags[NodeFlags["HasJSDoc"] = 2097152] = "HasJSDoc";
  NodeFlags[NodeFlags["JSDoc"] = 4194304] = "JSDoc";
  NodeFlags[NodeFlags["Ambient"] = 8388608] = "Ambient";
  NodeFlags[NodeFlags["InWithStatement"] = 16777216] = "InWithStatement";
  NodeFlags[NodeFlags["JsonFile"] = 33554432] = "JsonFile";
  NodeFlags[NodeFlags["PossiblyContainsDeprecatedTag"] = 67108864] = "PossiblyContainsDeprecatedTag";
  NodeFlags[NodeFlags["Unreachable"] = 134217728] = "Unreachable";
  NodeFlags[NodeFlags["ReparserTransformedLiteral"] = 268435456] = "ReparserTransformedLiteral";
  NodeFlags[NodeFlags["BlockScoped"] = 7] = "BlockScoped";
  NodeFlags[NodeFlags["Constant"] = 6] = "Constant";
  NodeFlags[NodeFlags["AwaitUsing"] = 6] = "AwaitUsing";
  NodeFlags[NodeFlags["ReachabilityCheckFlags"] = 768] = "ReachabilityCheckFlags";
  NodeFlags[NodeFlags["ReachabilityAndEmitFlags"] = 262912] = "ReachabilityAndEmitFlags";
  NodeFlags[NodeFlags["ContextFlags"] = 25263104] = "ContextFlags";
  NodeFlags[NodeFlags["TypeExcludesFlags"] = 10240] = "TypeExcludesFlags";
  NodeFlags[NodeFlags["PermanentlySetIncrementalFlags"] = 1572864] = "PermanentlySetIncrementalFlags";
  NodeFlags[NodeFlags["IdentifierHasExtendedUnicodeEscape"] = 128] = "IdentifierHasExtendedUnicodeEscape";
  NodeFlags[NodeFlags["IdentifierIsInJSDocNamespace"] = 262144] = "IdentifierIsInJSDocNamespace";
  NodeFlags[NodeFlags["NestedNamespace"] = 32] = "NestedNamespace";
})(NodeFlags || (NodeFlags = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/regularExpressionFlags.js
var RegularExpressionFlags;
(function(RegularExpressionFlags) {
  RegularExpressionFlags[RegularExpressionFlags["None"] = 0] = "None";
  RegularExpressionFlags[RegularExpressionFlags["HasIndices"] = 1] = "HasIndices";
  RegularExpressionFlags[RegularExpressionFlags["Global"] = 2] = "Global";
  RegularExpressionFlags[RegularExpressionFlags["IgnoreCase"] = 4] = "IgnoreCase";
  RegularExpressionFlags[RegularExpressionFlags["Multiline"] = 8] = "Multiline";
  RegularExpressionFlags[RegularExpressionFlags["DotAll"] = 16] = "DotAll";
  RegularExpressionFlags[RegularExpressionFlags["Unicode"] = 32] = "Unicode";
  RegularExpressionFlags[RegularExpressionFlags["UnicodeSets"] = 64] = "UnicodeSets";
  RegularExpressionFlags[RegularExpressionFlags["Sticky"] = 128] = "Sticky";
  RegularExpressionFlags[RegularExpressionFlags["AnyUnicodeMode"] = 96] = "AnyUnicodeMode";
})(RegularExpressionFlags || (RegularExpressionFlags = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/scriptKind.js
var ScriptKind;
(function(ScriptKind) {
  ScriptKind[ScriptKind["Unknown"] = 0] = "Unknown";
  ScriptKind[ScriptKind["JS"] = 1] = "JS";
  ScriptKind[ScriptKind["JSX"] = 2] = "JSX";
  ScriptKind[ScriptKind["TS"] = 3] = "TS";
  ScriptKind[ScriptKind["TSX"] = 4] = "TSX";
  ScriptKind[ScriptKind["External"] = 5] = "External";
  ScriptKind[ScriptKind["JSON"] = 6] = "JSON";
  ScriptKind[ScriptKind["Deferred"] = 7] = "Deferred";
})(ScriptKind || (ScriptKind = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/scriptTarget.js
var ScriptTarget;
(function(ScriptTarget) {
  ScriptTarget[ScriptTarget["ES2015"] = 2] = "ES2015";
  ScriptTarget[ScriptTarget["ES2016"] = 3] = "ES2016";
  ScriptTarget[ScriptTarget["ES2017"] = 4] = "ES2017";
  ScriptTarget[ScriptTarget["ES2018"] = 5] = "ES2018";
  ScriptTarget[ScriptTarget["ES2019"] = 6] = "ES2019";
  ScriptTarget[ScriptTarget["ES2020"] = 7] = "ES2020";
  ScriptTarget[ScriptTarget["ES2021"] = 8] = "ES2021";
  ScriptTarget[ScriptTarget["ES2022"] = 9] = "ES2022";
  ScriptTarget[ScriptTarget["ES2023"] = 10] = "ES2023";
  ScriptTarget[ScriptTarget["ES2024"] = 11] = "ES2024";
  ScriptTarget[ScriptTarget["ES2025"] = 12] = "ES2025";
  ScriptTarget[ScriptTarget["ESNext"] = 99] = "ESNext";
  ScriptTarget[ScriptTarget["JSON"] = 100] = "JSON";
  ScriptTarget[ScriptTarget["Latest"] = 99] = "Latest";
})(ScriptTarget || (ScriptTarget = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/syntaxKind.js
var SyntaxKind;
(function(SyntaxKind) {
  SyntaxKind[SyntaxKind["Unknown"] = 0] = "Unknown";
  SyntaxKind[SyntaxKind["EndOfFile"] = 1] = "EndOfFile";
  SyntaxKind[SyntaxKind["SingleLineCommentTrivia"] = 2] = "SingleLineCommentTrivia";
  SyntaxKind[SyntaxKind["MultiLineCommentTrivia"] = 3] = "MultiLineCommentTrivia";
  SyntaxKind[SyntaxKind["NewLineTrivia"] = 4] = "NewLineTrivia";
  SyntaxKind[SyntaxKind["WhitespaceTrivia"] = 5] = "WhitespaceTrivia";
  SyntaxKind[SyntaxKind["ConflictMarkerTrivia"] = 6] = "ConflictMarkerTrivia";
  SyntaxKind[SyntaxKind["NonTextFileMarkerTrivia"] = 7] = "NonTextFileMarkerTrivia";
  SyntaxKind[SyntaxKind["NumericLiteral"] = 8] = "NumericLiteral";
  SyntaxKind[SyntaxKind["BigIntLiteral"] = 9] = "BigIntLiteral";
  SyntaxKind[SyntaxKind["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind[SyntaxKind["JsxText"] = 11] = "JsxText";
  SyntaxKind[SyntaxKind["JsxTextAllWhiteSpaces"] = 12] = "JsxTextAllWhiteSpaces";
  SyntaxKind[SyntaxKind["RegularExpressionLiteral"] = 13] = "RegularExpressionLiteral";
  SyntaxKind[SyntaxKind["NoSubstitutionTemplateLiteral"] = 14] = "NoSubstitutionTemplateLiteral";
  SyntaxKind[SyntaxKind["TemplateHead"] = 15] = "TemplateHead";
  SyntaxKind[SyntaxKind["TemplateMiddle"] = 16] = "TemplateMiddle";
  SyntaxKind[SyntaxKind["TemplateTail"] = 17] = "TemplateTail";
  SyntaxKind[SyntaxKind["OpenBraceToken"] = 18] = "OpenBraceToken";
  SyntaxKind[SyntaxKind["CloseBraceToken"] = 19] = "CloseBraceToken";
  SyntaxKind[SyntaxKind["OpenParenToken"] = 20] = "OpenParenToken";
  SyntaxKind[SyntaxKind["CloseParenToken"] = 21] = "CloseParenToken";
  SyntaxKind[SyntaxKind["OpenBracketToken"] = 22] = "OpenBracketToken";
  SyntaxKind[SyntaxKind["CloseBracketToken"] = 23] = "CloseBracketToken";
  SyntaxKind[SyntaxKind["DotToken"] = 24] = "DotToken";
  SyntaxKind[SyntaxKind["DotDotDotToken"] = 25] = "DotDotDotToken";
  SyntaxKind[SyntaxKind["SemicolonToken"] = 26] = "SemicolonToken";
  SyntaxKind[SyntaxKind["CommaToken"] = 27] = "CommaToken";
  SyntaxKind[SyntaxKind["QuestionDotToken"] = 28] = "QuestionDotToken";
  SyntaxKind[SyntaxKind["LessThanToken"] = 29] = "LessThanToken";
  SyntaxKind[SyntaxKind["LessThanSlashToken"] = 30] = "LessThanSlashToken";
  SyntaxKind[SyntaxKind["GreaterThanToken"] = 31] = "GreaterThanToken";
  SyntaxKind[SyntaxKind["LessThanEqualsToken"] = 32] = "LessThanEqualsToken";
  SyntaxKind[SyntaxKind["GreaterThanEqualsToken"] = 33] = "GreaterThanEqualsToken";
  SyntaxKind[SyntaxKind["EqualsEqualsToken"] = 34] = "EqualsEqualsToken";
  SyntaxKind[SyntaxKind["ExclamationEqualsToken"] = 35] = "ExclamationEqualsToken";
  SyntaxKind[SyntaxKind["EqualsEqualsEqualsToken"] = 36] = "EqualsEqualsEqualsToken";
  SyntaxKind[SyntaxKind["ExclamationEqualsEqualsToken"] = 37] = "ExclamationEqualsEqualsToken";
  SyntaxKind[SyntaxKind["EqualsGreaterThanToken"] = 38] = "EqualsGreaterThanToken";
  SyntaxKind[SyntaxKind["PlusToken"] = 39] = "PlusToken";
  SyntaxKind[SyntaxKind["MinusToken"] = 40] = "MinusToken";
  SyntaxKind[SyntaxKind["AsteriskToken"] = 41] = "AsteriskToken";
  SyntaxKind[SyntaxKind["AsteriskAsteriskToken"] = 42] = "AsteriskAsteriskToken";
  SyntaxKind[SyntaxKind["SlashToken"] = 43] = "SlashToken";
  SyntaxKind[SyntaxKind["PercentToken"] = 44] = "PercentToken";
  SyntaxKind[SyntaxKind["PlusPlusToken"] = 45] = "PlusPlusToken";
  SyntaxKind[SyntaxKind["MinusMinusToken"] = 46] = "MinusMinusToken";
  SyntaxKind[SyntaxKind["LessThanLessThanToken"] = 47] = "LessThanLessThanToken";
  SyntaxKind[SyntaxKind["GreaterThanGreaterThanToken"] = 48] = "GreaterThanGreaterThanToken";
  SyntaxKind[SyntaxKind["GreaterThanGreaterThanGreaterThanToken"] = 49] = "GreaterThanGreaterThanGreaterThanToken";
  SyntaxKind[SyntaxKind["AmpersandToken"] = 50] = "AmpersandToken";
  SyntaxKind[SyntaxKind["BarToken"] = 51] = "BarToken";
  SyntaxKind[SyntaxKind["CaretToken"] = 52] = "CaretToken";
  SyntaxKind[SyntaxKind["ExclamationToken"] = 53] = "ExclamationToken";
  SyntaxKind[SyntaxKind["TildeToken"] = 54] = "TildeToken";
  SyntaxKind[SyntaxKind["AmpersandAmpersandToken"] = 55] = "AmpersandAmpersandToken";
  SyntaxKind[SyntaxKind["BarBarToken"] = 56] = "BarBarToken";
  SyntaxKind[SyntaxKind["QuestionToken"] = 57] = "QuestionToken";
  SyntaxKind[SyntaxKind["ColonToken"] = 58] = "ColonToken";
  SyntaxKind[SyntaxKind["AtToken"] = 59] = "AtToken";
  SyntaxKind[SyntaxKind["QuestionQuestionToken"] = 60] = "QuestionQuestionToken";
  SyntaxKind[SyntaxKind["BacktickToken"] = 61] = "BacktickToken";
  SyntaxKind[SyntaxKind["HashToken"] = 62] = "HashToken";
  SyntaxKind[SyntaxKind["EqualsToken"] = 63] = "EqualsToken";
  SyntaxKind[SyntaxKind["PlusEqualsToken"] = 64] = "PlusEqualsToken";
  SyntaxKind[SyntaxKind["MinusEqualsToken"] = 65] = "MinusEqualsToken";
  SyntaxKind[SyntaxKind["AsteriskEqualsToken"] = 66] = "AsteriskEqualsToken";
  SyntaxKind[SyntaxKind["AsteriskAsteriskEqualsToken"] = 67] = "AsteriskAsteriskEqualsToken";
  SyntaxKind[SyntaxKind["SlashEqualsToken"] = 68] = "SlashEqualsToken";
  SyntaxKind[SyntaxKind["PercentEqualsToken"] = 69] = "PercentEqualsToken";
  SyntaxKind[SyntaxKind["LessThanLessThanEqualsToken"] = 70] = "LessThanLessThanEqualsToken";
  SyntaxKind[SyntaxKind["GreaterThanGreaterThanEqualsToken"] = 71] = "GreaterThanGreaterThanEqualsToken";
  SyntaxKind[SyntaxKind["GreaterThanGreaterThanGreaterThanEqualsToken"] = 72] = "GreaterThanGreaterThanGreaterThanEqualsToken";
  SyntaxKind[SyntaxKind["AmpersandEqualsToken"] = 73] = "AmpersandEqualsToken";
  SyntaxKind[SyntaxKind["BarEqualsToken"] = 74] = "BarEqualsToken";
  SyntaxKind[SyntaxKind["BarBarEqualsToken"] = 75] = "BarBarEqualsToken";
  SyntaxKind[SyntaxKind["AmpersandAmpersandEqualsToken"] = 76] = "AmpersandAmpersandEqualsToken";
  SyntaxKind[SyntaxKind["QuestionQuestionEqualsToken"] = 77] = "QuestionQuestionEqualsToken";
  SyntaxKind[SyntaxKind["CaretEqualsToken"] = 78] = "CaretEqualsToken";
  SyntaxKind[SyntaxKind["Identifier"] = 79] = "Identifier";
  SyntaxKind[SyntaxKind["PrivateIdentifier"] = 80] = "PrivateIdentifier";
  SyntaxKind[SyntaxKind["JSDocCommentTextToken"] = 81] = "JSDocCommentTextToken";
  SyntaxKind[SyntaxKind["BreakKeyword"] = 82] = "BreakKeyword";
  SyntaxKind[SyntaxKind["CaseKeyword"] = 83] = "CaseKeyword";
  SyntaxKind[SyntaxKind["CatchKeyword"] = 84] = "CatchKeyword";
  SyntaxKind[SyntaxKind["ClassKeyword"] = 85] = "ClassKeyword";
  SyntaxKind[SyntaxKind["ConstKeyword"] = 86] = "ConstKeyword";
  SyntaxKind[SyntaxKind["ContinueKeyword"] = 87] = "ContinueKeyword";
  SyntaxKind[SyntaxKind["DebuggerKeyword"] = 88] = "DebuggerKeyword";
  SyntaxKind[SyntaxKind["DefaultKeyword"] = 89] = "DefaultKeyword";
  SyntaxKind[SyntaxKind["DeleteKeyword"] = 90] = "DeleteKeyword";
  SyntaxKind[SyntaxKind["DoKeyword"] = 91] = "DoKeyword";
  SyntaxKind[SyntaxKind["ElseKeyword"] = 92] = "ElseKeyword";
  SyntaxKind[SyntaxKind["EnumKeyword"] = 93] = "EnumKeyword";
  SyntaxKind[SyntaxKind["ExportKeyword"] = 94] = "ExportKeyword";
  SyntaxKind[SyntaxKind["ExtendsKeyword"] = 95] = "ExtendsKeyword";
  SyntaxKind[SyntaxKind["FalseKeyword"] = 96] = "FalseKeyword";
  SyntaxKind[SyntaxKind["FinallyKeyword"] = 97] = "FinallyKeyword";
  SyntaxKind[SyntaxKind["ForKeyword"] = 98] = "ForKeyword";
  SyntaxKind[SyntaxKind["FunctionKeyword"] = 99] = "FunctionKeyword";
  SyntaxKind[SyntaxKind["IfKeyword"] = 100] = "IfKeyword";
  SyntaxKind[SyntaxKind["ImportKeyword"] = 101] = "ImportKeyword";
  SyntaxKind[SyntaxKind["InKeyword"] = 102] = "InKeyword";
  SyntaxKind[SyntaxKind["InstanceOfKeyword"] = 103] = "InstanceOfKeyword";
  SyntaxKind[SyntaxKind["NewKeyword"] = 104] = "NewKeyword";
  SyntaxKind[SyntaxKind["NullKeyword"] = 105] = "NullKeyword";
  SyntaxKind[SyntaxKind["ReturnKeyword"] = 106] = "ReturnKeyword";
  SyntaxKind[SyntaxKind["SuperKeyword"] = 107] = "SuperKeyword";
  SyntaxKind[SyntaxKind["SwitchKeyword"] = 108] = "SwitchKeyword";
  SyntaxKind[SyntaxKind["ThisKeyword"] = 109] = "ThisKeyword";
  SyntaxKind[SyntaxKind["ThrowKeyword"] = 110] = "ThrowKeyword";
  SyntaxKind[SyntaxKind["TrueKeyword"] = 111] = "TrueKeyword";
  SyntaxKind[SyntaxKind["TryKeyword"] = 112] = "TryKeyword";
  SyntaxKind[SyntaxKind["TypeOfKeyword"] = 113] = "TypeOfKeyword";
  SyntaxKind[SyntaxKind["VarKeyword"] = 114] = "VarKeyword";
  SyntaxKind[SyntaxKind["VoidKeyword"] = 115] = "VoidKeyword";
  SyntaxKind[SyntaxKind["WhileKeyword"] = 116] = "WhileKeyword";
  SyntaxKind[SyntaxKind["WithKeyword"] = 117] = "WithKeyword";
  SyntaxKind[SyntaxKind["ImplementsKeyword"] = 118] = "ImplementsKeyword";
  SyntaxKind[SyntaxKind["InterfaceKeyword"] = 119] = "InterfaceKeyword";
  SyntaxKind[SyntaxKind["LetKeyword"] = 120] = "LetKeyword";
  SyntaxKind[SyntaxKind["PackageKeyword"] = 121] = "PackageKeyword";
  SyntaxKind[SyntaxKind["PrivateKeyword"] = 122] = "PrivateKeyword";
  SyntaxKind[SyntaxKind["ProtectedKeyword"] = 123] = "ProtectedKeyword";
  SyntaxKind[SyntaxKind["PublicKeyword"] = 124] = "PublicKeyword";
  SyntaxKind[SyntaxKind["StaticKeyword"] = 125] = "StaticKeyword";
  SyntaxKind[SyntaxKind["YieldKeyword"] = 126] = "YieldKeyword";
  SyntaxKind[SyntaxKind["AbstractKeyword"] = 127] = "AbstractKeyword";
  SyntaxKind[SyntaxKind["AccessorKeyword"] = 128] = "AccessorKeyword";
  SyntaxKind[SyntaxKind["AsKeyword"] = 129] = "AsKeyword";
  SyntaxKind[SyntaxKind["AssertsKeyword"] = 130] = "AssertsKeyword";
  SyntaxKind[SyntaxKind["AssertKeyword"] = 131] = "AssertKeyword";
  SyntaxKind[SyntaxKind["AnyKeyword"] = 132] = "AnyKeyword";
  SyntaxKind[SyntaxKind["AsyncKeyword"] = 133] = "AsyncKeyword";
  SyntaxKind[SyntaxKind["AwaitKeyword"] = 134] = "AwaitKeyword";
  SyntaxKind[SyntaxKind["BooleanKeyword"] = 135] = "BooleanKeyword";
  SyntaxKind[SyntaxKind["ConstructorKeyword"] = 136] = "ConstructorKeyword";
  SyntaxKind[SyntaxKind["DeclareKeyword"] = 137] = "DeclareKeyword";
  SyntaxKind[SyntaxKind["GetKeyword"] = 138] = "GetKeyword";
  SyntaxKind[SyntaxKind["ImmediateKeyword"] = 139] = "ImmediateKeyword";
  SyntaxKind[SyntaxKind["InferKeyword"] = 140] = "InferKeyword";
  SyntaxKind[SyntaxKind["IntrinsicKeyword"] = 141] = "IntrinsicKeyword";
  SyntaxKind[SyntaxKind["IsKeyword"] = 142] = "IsKeyword";
  SyntaxKind[SyntaxKind["KeyOfKeyword"] = 143] = "KeyOfKeyword";
  SyntaxKind[SyntaxKind["ModuleKeyword"] = 144] = "ModuleKeyword";
  SyntaxKind[SyntaxKind["NamespaceKeyword"] = 145] = "NamespaceKeyword";
  SyntaxKind[SyntaxKind["NeverKeyword"] = 146] = "NeverKeyword";
  SyntaxKind[SyntaxKind["OutKeyword"] = 147] = "OutKeyword";
  SyntaxKind[SyntaxKind["ReadonlyKeyword"] = 148] = "ReadonlyKeyword";
  SyntaxKind[SyntaxKind["RequireKeyword"] = 149] = "RequireKeyword";
  SyntaxKind[SyntaxKind["NumberKeyword"] = 150] = "NumberKeyword";
  SyntaxKind[SyntaxKind["ObjectKeyword"] = 151] = "ObjectKeyword";
  SyntaxKind[SyntaxKind["SatisfiesKeyword"] = 152] = "SatisfiesKeyword";
  SyntaxKind[SyntaxKind["SetKeyword"] = 153] = "SetKeyword";
  SyntaxKind[SyntaxKind["StringKeyword"] = 154] = "StringKeyword";
  SyntaxKind[SyntaxKind["SymbolKeyword"] = 155] = "SymbolKeyword";
  SyntaxKind[SyntaxKind["TypeKeyword"] = 156] = "TypeKeyword";
  SyntaxKind[SyntaxKind["UndefinedKeyword"] = 157] = "UndefinedKeyword";
  SyntaxKind[SyntaxKind["UniqueKeyword"] = 158] = "UniqueKeyword";
  SyntaxKind[SyntaxKind["UnknownKeyword"] = 159] = "UnknownKeyword";
  SyntaxKind[SyntaxKind["UsingKeyword"] = 160] = "UsingKeyword";
  SyntaxKind[SyntaxKind["FromKeyword"] = 161] = "FromKeyword";
  SyntaxKind[SyntaxKind["GlobalKeyword"] = 162] = "GlobalKeyword";
  SyntaxKind[SyntaxKind["BigIntKeyword"] = 163] = "BigIntKeyword";
  SyntaxKind[SyntaxKind["OverrideKeyword"] = 164] = "OverrideKeyword";
  SyntaxKind[SyntaxKind["OfKeyword"] = 165] = "OfKeyword";
  SyntaxKind[SyntaxKind["DeferKeyword"] = 166] = "DeferKeyword";
  SyntaxKind[SyntaxKind["QualifiedName"] = 167] = "QualifiedName";
  SyntaxKind[SyntaxKind["ComputedPropertyName"] = 168] = "ComputedPropertyName";
  SyntaxKind[SyntaxKind["TypeParameter"] = 169] = "TypeParameter";
  SyntaxKind[SyntaxKind["Parameter"] = 170] = "Parameter";
  SyntaxKind[SyntaxKind["Decorator"] = 171] = "Decorator";
  SyntaxKind[SyntaxKind["PropertySignature"] = 172] = "PropertySignature";
  SyntaxKind[SyntaxKind["PropertyDeclaration"] = 173] = "PropertyDeclaration";
  SyntaxKind[SyntaxKind["MethodSignature"] = 174] = "MethodSignature";
  SyntaxKind[SyntaxKind["MethodDeclaration"] = 175] = "MethodDeclaration";
  SyntaxKind[SyntaxKind["ClassStaticBlockDeclaration"] = 176] = "ClassStaticBlockDeclaration";
  SyntaxKind[SyntaxKind["Constructor"] = 177] = "Constructor";
  SyntaxKind[SyntaxKind["GetAccessor"] = 178] = "GetAccessor";
  SyntaxKind[SyntaxKind["SetAccessor"] = 179] = "SetAccessor";
  SyntaxKind[SyntaxKind["CallSignature"] = 180] = "CallSignature";
  SyntaxKind[SyntaxKind["ConstructSignature"] = 181] = "ConstructSignature";
  SyntaxKind[SyntaxKind["IndexSignature"] = 182] = "IndexSignature";
  SyntaxKind[SyntaxKind["TypePredicate"] = 183] = "TypePredicate";
  SyntaxKind[SyntaxKind["TypeReference"] = 184] = "TypeReference";
  SyntaxKind[SyntaxKind["FunctionType"] = 185] = "FunctionType";
  SyntaxKind[SyntaxKind["ConstructorType"] = 186] = "ConstructorType";
  SyntaxKind[SyntaxKind["TypeQuery"] = 187] = "TypeQuery";
  SyntaxKind[SyntaxKind["TypeLiteral"] = 188] = "TypeLiteral";
  SyntaxKind[SyntaxKind["ArrayType"] = 189] = "ArrayType";
  SyntaxKind[SyntaxKind["TupleType"] = 190] = "TupleType";
  SyntaxKind[SyntaxKind["OptionalType"] = 191] = "OptionalType";
  SyntaxKind[SyntaxKind["RestType"] = 192] = "RestType";
  SyntaxKind[SyntaxKind["UnionType"] = 193] = "UnionType";
  SyntaxKind[SyntaxKind["IntersectionType"] = 194] = "IntersectionType";
  SyntaxKind[SyntaxKind["ConditionalType"] = 195] = "ConditionalType";
  SyntaxKind[SyntaxKind["InferType"] = 196] = "InferType";
  SyntaxKind[SyntaxKind["ParenthesizedType"] = 197] = "ParenthesizedType";
  SyntaxKind[SyntaxKind["ThisType"] = 198] = "ThisType";
  SyntaxKind[SyntaxKind["TypeOperator"] = 199] = "TypeOperator";
  SyntaxKind[SyntaxKind["IndexedAccessType"] = 200] = "IndexedAccessType";
  SyntaxKind[SyntaxKind["MappedType"] = 201] = "MappedType";
  SyntaxKind[SyntaxKind["LiteralType"] = 202] = "LiteralType";
  SyntaxKind[SyntaxKind["NamedTupleMember"] = 203] = "NamedTupleMember";
  SyntaxKind[SyntaxKind["TemplateLiteralType"] = 204] = "TemplateLiteralType";
  SyntaxKind[SyntaxKind["TemplateLiteralTypeSpan"] = 205] = "TemplateLiteralTypeSpan";
  SyntaxKind[SyntaxKind["ImportType"] = 206] = "ImportType";
  SyntaxKind[SyntaxKind["ObjectBindingPattern"] = 207] = "ObjectBindingPattern";
  SyntaxKind[SyntaxKind["ArrayBindingPattern"] = 208] = "ArrayBindingPattern";
  SyntaxKind[SyntaxKind["BindingElement"] = 209] = "BindingElement";
  SyntaxKind[SyntaxKind["ArrayLiteralExpression"] = 210] = "ArrayLiteralExpression";
  SyntaxKind[SyntaxKind["ObjectLiteralExpression"] = 211] = "ObjectLiteralExpression";
  SyntaxKind[SyntaxKind["PropertyAccessExpression"] = 212] = "PropertyAccessExpression";
  SyntaxKind[SyntaxKind["ElementAccessExpression"] = 213] = "ElementAccessExpression";
  SyntaxKind[SyntaxKind["CallExpression"] = 214] = "CallExpression";
  SyntaxKind[SyntaxKind["NewExpression"] = 215] = "NewExpression";
  SyntaxKind[SyntaxKind["TaggedTemplateExpression"] = 216] = "TaggedTemplateExpression";
  SyntaxKind[SyntaxKind["TypeAssertionExpression"] = 217] = "TypeAssertionExpression";
  SyntaxKind[SyntaxKind["ParenthesizedExpression"] = 218] = "ParenthesizedExpression";
  SyntaxKind[SyntaxKind["FunctionExpression"] = 219] = "FunctionExpression";
  SyntaxKind[SyntaxKind["ArrowFunction"] = 220] = "ArrowFunction";
  SyntaxKind[SyntaxKind["DeleteExpression"] = 221] = "DeleteExpression";
  SyntaxKind[SyntaxKind["TypeOfExpression"] = 222] = "TypeOfExpression";
  SyntaxKind[SyntaxKind["VoidExpression"] = 223] = "VoidExpression";
  SyntaxKind[SyntaxKind["AwaitExpression"] = 224] = "AwaitExpression";
  SyntaxKind[SyntaxKind["PrefixUnaryExpression"] = 225] = "PrefixUnaryExpression";
  SyntaxKind[SyntaxKind["PostfixUnaryExpression"] = 226] = "PostfixUnaryExpression";
  SyntaxKind[SyntaxKind["BinaryExpression"] = 227] = "BinaryExpression";
  SyntaxKind[SyntaxKind["ConditionalExpression"] = 228] = "ConditionalExpression";
  SyntaxKind[SyntaxKind["TemplateExpression"] = 229] = "TemplateExpression";
  SyntaxKind[SyntaxKind["YieldExpression"] = 230] = "YieldExpression";
  SyntaxKind[SyntaxKind["SpreadElement"] = 231] = "SpreadElement";
  SyntaxKind[SyntaxKind["ClassExpression"] = 232] = "ClassExpression";
  SyntaxKind[SyntaxKind["OmittedExpression"] = 233] = "OmittedExpression";
  SyntaxKind[SyntaxKind["ExpressionWithTypeArguments"] = 234] = "ExpressionWithTypeArguments";
  SyntaxKind[SyntaxKind["AsExpression"] = 235] = "AsExpression";
  SyntaxKind[SyntaxKind["NonNullExpression"] = 236] = "NonNullExpression";
  SyntaxKind[SyntaxKind["MetaProperty"] = 237] = "MetaProperty";
  SyntaxKind[SyntaxKind["SyntheticExpression"] = 238] = "SyntheticExpression";
  SyntaxKind[SyntaxKind["SatisfiesExpression"] = 239] = "SatisfiesExpression";
  SyntaxKind[SyntaxKind["TemplateSpan"] = 240] = "TemplateSpan";
  SyntaxKind[SyntaxKind["SemicolonClassElement"] = 241] = "SemicolonClassElement";
  SyntaxKind[SyntaxKind["Block"] = 242] = "Block";
  SyntaxKind[SyntaxKind["EmptyStatement"] = 243] = "EmptyStatement";
  SyntaxKind[SyntaxKind["VariableStatement"] = 244] = "VariableStatement";
  SyntaxKind[SyntaxKind["ExpressionStatement"] = 245] = "ExpressionStatement";
  SyntaxKind[SyntaxKind["IfStatement"] = 246] = "IfStatement";
  SyntaxKind[SyntaxKind["DoStatement"] = 247] = "DoStatement";
  SyntaxKind[SyntaxKind["WhileStatement"] = 248] = "WhileStatement";
  SyntaxKind[SyntaxKind["ForStatement"] = 249] = "ForStatement";
  SyntaxKind[SyntaxKind["ForInStatement"] = 250] = "ForInStatement";
  SyntaxKind[SyntaxKind["ForOfStatement"] = 251] = "ForOfStatement";
  SyntaxKind[SyntaxKind["ContinueStatement"] = 252] = "ContinueStatement";
  SyntaxKind[SyntaxKind["BreakStatement"] = 253] = "BreakStatement";
  SyntaxKind[SyntaxKind["ReturnStatement"] = 254] = "ReturnStatement";
  SyntaxKind[SyntaxKind["WithStatement"] = 255] = "WithStatement";
  SyntaxKind[SyntaxKind["SwitchStatement"] = 256] = "SwitchStatement";
  SyntaxKind[SyntaxKind["LabeledStatement"] = 257] = "LabeledStatement";
  SyntaxKind[SyntaxKind["ThrowStatement"] = 258] = "ThrowStatement";
  SyntaxKind[SyntaxKind["TryStatement"] = 259] = "TryStatement";
  SyntaxKind[SyntaxKind["DebuggerStatement"] = 260] = "DebuggerStatement";
  SyntaxKind[SyntaxKind["VariableDeclaration"] = 261] = "VariableDeclaration";
  SyntaxKind[SyntaxKind["VariableDeclarationList"] = 262] = "VariableDeclarationList";
  SyntaxKind[SyntaxKind["FunctionDeclaration"] = 263] = "FunctionDeclaration";
  SyntaxKind[SyntaxKind["ClassDeclaration"] = 264] = "ClassDeclaration";
  SyntaxKind[SyntaxKind["InterfaceDeclaration"] = 265] = "InterfaceDeclaration";
  SyntaxKind[SyntaxKind["TypeAliasDeclaration"] = 266] = "TypeAliasDeclaration";
  SyntaxKind[SyntaxKind["EnumDeclaration"] = 267] = "EnumDeclaration";
  SyntaxKind[SyntaxKind["ModuleDeclaration"] = 268] = "ModuleDeclaration";
  SyntaxKind[SyntaxKind["ModuleBlock"] = 269] = "ModuleBlock";
  SyntaxKind[SyntaxKind["CaseBlock"] = 270] = "CaseBlock";
  SyntaxKind[SyntaxKind["NamespaceExportDeclaration"] = 271] = "NamespaceExportDeclaration";
  SyntaxKind[SyntaxKind["ImportEqualsDeclaration"] = 272] = "ImportEqualsDeclaration";
  SyntaxKind[SyntaxKind["ImportDeclaration"] = 273] = "ImportDeclaration";
  SyntaxKind[SyntaxKind["ImportClause"] = 274] = "ImportClause";
  SyntaxKind[SyntaxKind["NamespaceImport"] = 275] = "NamespaceImport";
  SyntaxKind[SyntaxKind["NamedImports"] = 276] = "NamedImports";
  SyntaxKind[SyntaxKind["ImportSpecifier"] = 277] = "ImportSpecifier";
  SyntaxKind[SyntaxKind["ExportAssignment"] = 278] = "ExportAssignment";
  SyntaxKind[SyntaxKind["ExportDeclaration"] = 279] = "ExportDeclaration";
  SyntaxKind[SyntaxKind["NamedExports"] = 280] = "NamedExports";
  SyntaxKind[SyntaxKind["NamespaceExport"] = 281] = "NamespaceExport";
  SyntaxKind[SyntaxKind["ExportSpecifier"] = 282] = "ExportSpecifier";
  SyntaxKind[SyntaxKind["MissingDeclaration"] = 283] = "MissingDeclaration";
  SyntaxKind[SyntaxKind["ExternalModuleReference"] = 284] = "ExternalModuleReference";
  SyntaxKind[SyntaxKind["JsxElement"] = 285] = "JsxElement";
  SyntaxKind[SyntaxKind["JsxSelfClosingElement"] = 286] = "JsxSelfClosingElement";
  SyntaxKind[SyntaxKind["JsxOpeningElement"] = 287] = "JsxOpeningElement";
  SyntaxKind[SyntaxKind["JsxClosingElement"] = 288] = "JsxClosingElement";
  SyntaxKind[SyntaxKind["JsxFragment"] = 289] = "JsxFragment";
  SyntaxKind[SyntaxKind["JsxOpeningFragment"] = 290] = "JsxOpeningFragment";
  SyntaxKind[SyntaxKind["JsxClosingFragment"] = 291] = "JsxClosingFragment";
  SyntaxKind[SyntaxKind["JsxAttribute"] = 292] = "JsxAttribute";
  SyntaxKind[SyntaxKind["JsxAttributes"] = 293] = "JsxAttributes";
  SyntaxKind[SyntaxKind["JsxSpreadAttribute"] = 294] = "JsxSpreadAttribute";
  SyntaxKind[SyntaxKind["JsxExpression"] = 295] = "JsxExpression";
  SyntaxKind[SyntaxKind["JsxNamespacedName"] = 296] = "JsxNamespacedName";
  SyntaxKind[SyntaxKind["CaseClause"] = 297] = "CaseClause";
  SyntaxKind[SyntaxKind["DefaultClause"] = 298] = "DefaultClause";
  SyntaxKind[SyntaxKind["HeritageClause"] = 299] = "HeritageClause";
  SyntaxKind[SyntaxKind["CatchClause"] = 300] = "CatchClause";
  SyntaxKind[SyntaxKind["ImportAttributes"] = 301] = "ImportAttributes";
  SyntaxKind[SyntaxKind["ImportAttribute"] = 302] = "ImportAttribute";
  SyntaxKind[SyntaxKind["PropertyAssignment"] = 303] = "PropertyAssignment";
  SyntaxKind[SyntaxKind["ShorthandPropertyAssignment"] = 304] = "ShorthandPropertyAssignment";
  SyntaxKind[SyntaxKind["SpreadAssignment"] = 305] = "SpreadAssignment";
  SyntaxKind[SyntaxKind["EnumMember"] = 306] = "EnumMember";
  SyntaxKind[SyntaxKind["SourceFile"] = 307] = "SourceFile";
  SyntaxKind[SyntaxKind["JSDocTypeExpression"] = 308] = "JSDocTypeExpression";
  SyntaxKind[SyntaxKind["JSDocNameReference"] = 309] = "JSDocNameReference";
  SyntaxKind[SyntaxKind["JSDocAllType"] = 310] = "JSDocAllType";
  SyntaxKind[SyntaxKind["JSDocNullableType"] = 311] = "JSDocNullableType";
  SyntaxKind[SyntaxKind["JSDocNonNullableType"] = 312] = "JSDocNonNullableType";
  SyntaxKind[SyntaxKind["JSDocOptionalType"] = 313] = "JSDocOptionalType";
  SyntaxKind[SyntaxKind["JSDocVariadicType"] = 314] = "JSDocVariadicType";
  SyntaxKind[SyntaxKind["JSDoc"] = 315] = "JSDoc";
  SyntaxKind[SyntaxKind["JSDocText"] = 316] = "JSDocText";
  SyntaxKind[SyntaxKind["JSDocTypeLiteral"] = 317] = "JSDocTypeLiteral";
  SyntaxKind[SyntaxKind["JSDocSignature"] = 318] = "JSDocSignature";
  SyntaxKind[SyntaxKind["JSDocLink"] = 319] = "JSDocLink";
  SyntaxKind[SyntaxKind["JSDocLinkCode"] = 320] = "JSDocLinkCode";
  SyntaxKind[SyntaxKind["JSDocLinkPlain"] = 321] = "JSDocLinkPlain";
  SyntaxKind[SyntaxKind["JSDocUnknownTag"] = 322] = "JSDocUnknownTag";
  SyntaxKind[SyntaxKind["JSDocAugmentsTag"] = 323] = "JSDocAugmentsTag";
  SyntaxKind[SyntaxKind["JSDocImplementsTag"] = 324] = "JSDocImplementsTag";
  SyntaxKind[SyntaxKind["JSDocDeprecatedTag"] = 325] = "JSDocDeprecatedTag";
  SyntaxKind[SyntaxKind["JSDocPublicTag"] = 326] = "JSDocPublicTag";
  SyntaxKind[SyntaxKind["JSDocPrivateTag"] = 327] = "JSDocPrivateTag";
  SyntaxKind[SyntaxKind["JSDocProtectedTag"] = 328] = "JSDocProtectedTag";
  SyntaxKind[SyntaxKind["JSDocReadonlyTag"] = 329] = "JSDocReadonlyTag";
  SyntaxKind[SyntaxKind["JSDocOverrideTag"] = 330] = "JSDocOverrideTag";
  SyntaxKind[SyntaxKind["JSDocCallbackTag"] = 331] = "JSDocCallbackTag";
  SyntaxKind[SyntaxKind["JSDocOverloadTag"] = 332] = "JSDocOverloadTag";
  SyntaxKind[SyntaxKind["JSDocParameterTag"] = 333] = "JSDocParameterTag";
  SyntaxKind[SyntaxKind["JSDocReturnTag"] = 334] = "JSDocReturnTag";
  SyntaxKind[SyntaxKind["JSDocThisTag"] = 335] = "JSDocThisTag";
  SyntaxKind[SyntaxKind["JSDocTypeTag"] = 336] = "JSDocTypeTag";
  SyntaxKind[SyntaxKind["JSDocTemplateTag"] = 337] = "JSDocTemplateTag";
  SyntaxKind[SyntaxKind["JSDocTypedefTag"] = 338] = "JSDocTypedefTag";
  SyntaxKind[SyntaxKind["JSDocSeeTag"] = 339] = "JSDocSeeTag";
  SyntaxKind[SyntaxKind["JSDocPropertyTag"] = 340] = "JSDocPropertyTag";
  SyntaxKind[SyntaxKind["JSDocThrowsTag"] = 341] = "JSDocThrowsTag";
  SyntaxKind[SyntaxKind["JSDocSatisfiesTag"] = 342] = "JSDocSatisfiesTag";
  SyntaxKind[SyntaxKind["JSDocImportTag"] = 343] = "JSDocImportTag";
  SyntaxKind[SyntaxKind["SyntaxList"] = 344] = "SyntaxList";
  SyntaxKind[SyntaxKind["JSTypeAliasDeclaration"] = 345] = "JSTypeAliasDeclaration";
  SyntaxKind[SyntaxKind["JSImportDeclaration"] = 346] = "JSImportDeclaration";
  SyntaxKind[SyntaxKind["NotEmittedStatement"] = 347] = "NotEmittedStatement";
  SyntaxKind[SyntaxKind["PartiallyEmittedExpression"] = 348] = "PartiallyEmittedExpression";
  SyntaxKind[SyntaxKind["SyntheticReferenceExpression"] = 349] = "SyntheticReferenceExpression";
  SyntaxKind[SyntaxKind["NotEmittedTypeElement"] = 350] = "NotEmittedTypeElement";
  SyntaxKind[SyntaxKind["Count"] = 351] = "Count";
  SyntaxKind[SyntaxKind["FirstAssignment"] = 63] = "FirstAssignment";
  SyntaxKind[SyntaxKind["LastAssignment"] = 78] = "LastAssignment";
  SyntaxKind[SyntaxKind["FirstCompoundAssignment"] = 64] = "FirstCompoundAssignment";
  SyntaxKind[SyntaxKind["LastCompoundAssignment"] = 78] = "LastCompoundAssignment";
  SyntaxKind[SyntaxKind["FirstReservedWord"] = 82] = "FirstReservedWord";
  SyntaxKind[SyntaxKind["LastReservedWord"] = 117] = "LastReservedWord";
  SyntaxKind[SyntaxKind["FirstKeyword"] = 82] = "FirstKeyword";
  SyntaxKind[SyntaxKind["LastKeyword"] = 166] = "LastKeyword";
  SyntaxKind[SyntaxKind["FirstFutureReservedWord"] = 118] = "FirstFutureReservedWord";
  SyntaxKind[SyntaxKind["LastFutureReservedWord"] = 126] = "LastFutureReservedWord";
  SyntaxKind[SyntaxKind["FirstTypeNode"] = 183] = "FirstTypeNode";
  SyntaxKind[SyntaxKind["LastTypeNode"] = 206] = "LastTypeNode";
  SyntaxKind[SyntaxKind["FirstPunctuation"] = 18] = "FirstPunctuation";
  SyntaxKind[SyntaxKind["LastPunctuation"] = 78] = "LastPunctuation";
  SyntaxKind[SyntaxKind["FirstToken"] = 0] = "FirstToken";
  SyntaxKind[SyntaxKind["LastToken"] = 166] = "LastToken";
  SyntaxKind[SyntaxKind["FirstLiteralToken"] = 8] = "FirstLiteralToken";
  SyntaxKind[SyntaxKind["LastLiteralToken"] = 14] = "LastLiteralToken";
  SyntaxKind[SyntaxKind["FirstTemplateToken"] = 14] = "FirstTemplateToken";
  SyntaxKind[SyntaxKind["LastTemplateToken"] = 17] = "LastTemplateToken";
  SyntaxKind[SyntaxKind["FirstBinaryOperator"] = 29] = "FirstBinaryOperator";
  SyntaxKind[SyntaxKind["LastBinaryOperator"] = 78] = "LastBinaryOperator";
  SyntaxKind[SyntaxKind["FirstStatement"] = 244] = "FirstStatement";
  SyntaxKind[SyntaxKind["LastStatement"] = 260] = "LastStatement";
  SyntaxKind[SyntaxKind["FirstNode"] = 167] = "FirstNode";
  SyntaxKind[SyntaxKind["FirstJSDocNode"] = 308] = "FirstJSDocNode";
  SyntaxKind[SyntaxKind["LastJSDocNode"] = 343] = "LastJSDocNode";
  SyntaxKind[SyntaxKind["FirstJSDocTagNode"] = 322] = "FirstJSDocTagNode";
  SyntaxKind[SyntaxKind["LastJSDocTagNode"] = 343] = "LastJSDocTagNode";
  SyntaxKind[SyntaxKind["FirstContextualKeyword"] = 127] = "FirstContextualKeyword";
  SyntaxKind[SyntaxKind["LastContextualKeyword"] = 166] = "LastContextualKeyword";
  SyntaxKind[SyntaxKind["LastUnaryOperator"] = 54] = "LastUnaryOperator";
  SyntaxKind[SyntaxKind["FirstTriviaToken"] = 2] = "FirstTriviaToken";
  SyntaxKind[SyntaxKind["LastTriviaToken"] = 6] = "LastTriviaToken";
})(SyntaxKind || (SyntaxKind = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/tokenFlags.js
var TokenFlags;
(function(TokenFlags) {
  TokenFlags[TokenFlags["None"] = 0] = "None";
  TokenFlags[TokenFlags["PrecedingLineBreak"] = 1] = "PrecedingLineBreak";
  TokenFlags[TokenFlags["PrecedingJSDocComment"] = 2] = "PrecedingJSDocComment";
  TokenFlags[TokenFlags["Unterminated"] = 4] = "Unterminated";
  TokenFlags[TokenFlags["ExtendedUnicodeEscape"] = 8] = "ExtendedUnicodeEscape";
  TokenFlags[TokenFlags["Scientific"] = 16] = "Scientific";
  TokenFlags[TokenFlags["Octal"] = 32] = "Octal";
  TokenFlags[TokenFlags["HexSpecifier"] = 64] = "HexSpecifier";
  TokenFlags[TokenFlags["BinarySpecifier"] = 128] = "BinarySpecifier";
  TokenFlags[TokenFlags["OctalSpecifier"] = 256] = "OctalSpecifier";
  TokenFlags[TokenFlags["ContainsSeparator"] = 512] = "ContainsSeparator";
  TokenFlags[TokenFlags["UnicodeEscape"] = 1024] = "UnicodeEscape";
  TokenFlags[TokenFlags["ContainsInvalidEscape"] = 2048] = "ContainsInvalidEscape";
  TokenFlags[TokenFlags["HexEscape"] = 4096] = "HexEscape";
  TokenFlags[TokenFlags["ContainsLeadingZero"] = 8192] = "ContainsLeadingZero";
  TokenFlags[TokenFlags["ContainsInvalidSeparator"] = 16384] = "ContainsInvalidSeparator";
  TokenFlags[TokenFlags["PrecedingJSDocLeadingAsterisks"] = 32768] = "PrecedingJSDocLeadingAsterisks";
  TokenFlags[TokenFlags["SingleQuote"] = 65536] = "SingleQuote";
  TokenFlags[TokenFlags["PrecedingJSDocWithDeprecated"] = 131072] = "PrecedingJSDocWithDeprecated";
  TokenFlags[TokenFlags["PrecedingJSDocWithSeeOrLink"] = 262144] = "PrecedingJSDocWithSeeOrLink";
  TokenFlags[TokenFlags["BinaryOrOctalSpecifier"] = 384] = "BinaryOrOctalSpecifier";
  TokenFlags[TokenFlags["WithSpecifier"] = 448] = "WithSpecifier";
  TokenFlags[TokenFlags["StringLiteralFlags"] = 72716] = "StringLiteralFlags";
  TokenFlags[TokenFlags["NumericLiteralFlags"] = 25584] = "NumericLiteralFlags";
  TokenFlags[TokenFlags["TemplateLiteralLikeFlags"] = 7180] = "TemplateLiteralLikeFlags";
  TokenFlags[TokenFlags["RegularExpressionLiteralFlags"] = 4] = "RegularExpressionLiteralFlags";
  TokenFlags[TokenFlags["IsInvalid"] = 26656] = "IsInvalid";
})(TokenFlags || (TokenFlags = {}));
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/ast/utils.js
function unescapeLeadingUnderscores(identifier) {
  const id = identifier;
  return id.length >= 3 && id.charCodeAt(0) === CharacterCodes._ && id.charCodeAt(1) === CharacterCodes._ && id.charCodeAt(2) === CharacterCodes._ ? id.slice(1) : id;
}
function cloneSourceFileData(sourceFile) {
  return {
    statements: sourceFile.statements,
    endOfFileToken: sourceFile.endOfFileToken,
    text: sourceFile.text,
    fileName: sourceFile.fileName,
    path: sourceFile.path,
    languageVariant: sourceFile.languageVariant,
    scriptKind: sourceFile.scriptKind,
    isDeclarationFile: sourceFile.isDeclarationFile,
    referencedFiles: sourceFile.referencedFiles,
    typeReferenceDirectives: sourceFile.typeReferenceDirectives,
    libReferenceDirectives: sourceFile.libReferenceDirectives,
    imports: sourceFile.imports,
    moduleAugmentations: sourceFile.moduleAugmentations,
    ambientModuleNames: sourceFile.ambientModuleNames,
    externalModuleIndicator: sourceFile.externalModuleIndicator,
    tokenCache: undefined
  };
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/enums/outerExpressionKinds.js
var OuterExpressionKinds;
(function(OuterExpressionKinds) {
  OuterExpressionKinds[OuterExpressionKinds["Parentheses"] = 1] = "Parentheses";
  OuterExpressionKinds[OuterExpressionKinds["TypeAssertions"] = 2] = "TypeAssertions";
  OuterExpressionKinds[OuterExpressionKinds["NonNullAssertions"] = 4] = "NonNullAssertions";
  OuterExpressionKinds[OuterExpressionKinds["PartiallyEmittedExpressions"] = 8] = "PartiallyEmittedExpressions";
  OuterExpressionKinds[OuterExpressionKinds["ExpressionsWithTypeArguments"] = 16] = "ExpressionsWithTypeArguments";
  OuterExpressionKinds[OuterExpressionKinds["Satisfies"] = 32] = "Satisfies";
  OuterExpressionKinds[OuterExpressionKinds["ExcludeJSDocTypeAssertion"] = 64] = "ExcludeJSDocTypeAssertion";
  OuterExpressionKinds[OuterExpressionKinds["Assignments"] = 128] = "Assignments";
  OuterExpressionKinds[OuterExpressionKinds["Comma"] = 256] = "Comma";
  OuterExpressionKinds[OuterExpressionKinds["Assertions"] = 38] = "Assertions";
  OuterExpressionKinds[OuterExpressionKinds["All"] = 63] = "All";
  OuterExpressionKinds[OuterExpressionKinds["AllExceptAssertionsOrExpressionsWithTypeArguments"] = 9] = "AllExceptAssertionsOrExpressionsWithTypeArguments";
  OuterExpressionKinds[OuterExpressionKinds["ExpressionTypePassthrough"] = 385] = "ExpressionTypePassthrough";
})(OuterExpressionKinds || (OuterExpressionKinds = {}));

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/ast/is.generated.js
function isIdentifier(node) {
  return node.kind === SyntaxKind.Identifier;
}
function isCaseBlock(node) {
  return node.kind === SyntaxKind.CaseBlock;
}
function isCatchClause(node) {
  return node.kind === SyntaxKind.CatchClause;
}
function isBlock(node) {
  return node.kind === SyntaxKind.Block;
}
function isVariableStatement(node) {
  return node.kind === SyntaxKind.VariableStatement;
}
function isVariableDeclaration(node) {
  return node.kind === SyntaxKind.VariableDeclaration;
}
function isVariableDeclarationList(node) {
  return node.kind === SyntaxKind.VariableDeclarationList;
}
function isFunctionDeclaration(node) {
  return node.kind === SyntaxKind.FunctionDeclaration;
}
function isClassDeclaration(node) {
  return node.kind === SyntaxKind.ClassDeclaration;
}
function isClassExpression(node) {
  return node.kind === SyntaxKind.ClassExpression;
}
function isInterfaceDeclaration(node) {
  return node.kind === SyntaxKind.InterfaceDeclaration;
}
function isTypeAliasDeclaration(node) {
  switch (node.kind) {
    case SyntaxKind.TypeAliasDeclaration:
    case SyntaxKind.JSTypeAliasDeclaration:
      return true;
    default:
      return false;
  }
}
function isEnumDeclaration(node) {
  return node.kind === SyntaxKind.EnumDeclaration;
}
function isImportDeclaration(node) {
  switch (node.kind) {
    case SyntaxKind.ImportDeclaration:
    case SyntaxKind.JSImportDeclaration:
      return true;
    default:
      return false;
  }
}
function isConstructorDeclaration(node) {
  return node.kind === SyntaxKind.Constructor;
}
function isMethodDeclaration(node) {
  return node.kind === SyntaxKind.MethodDeclaration;
}
function isStringLiteral(node) {
  return node.kind === SyntaxKind.StringLiteral;
}
function isArrowFunction(node) {
  return node.kind === SyntaxKind.ArrowFunction;
}
function isFunctionExpression(node) {
  return node.kind === SyntaxKind.FunctionExpression;
}
function isElementAccessExpression(node) {
  return node.kind === SyntaxKind.ElementAccessExpression;
}
function isCallExpression(node) {
  return node.kind === SyntaxKind.CallExpression;
}
function isNewExpression(node) {
  return node.kind === SyntaxKind.NewExpression;
}
function isExpressionWithTypeArguments(node) {
  return node.kind === SyntaxKind.ExpressionWithTypeArguments;
}
function isImportAttributes(node) {
  return node.kind === SyntaxKind.ImportAttributes;
}
function isTemplateHead(node) {
  return node.kind === SyntaxKind.TemplateHead;
}
function isJsxAttributes(node) {
  return node.kind === SyntaxKind.JsxAttributes;
}
function isJsxOpeningElement(node) {
  return node.kind === SyntaxKind.JsxOpeningElement;
}
function isJsxSelfClosingElement(node) {
  return node.kind === SyntaxKind.JsxSelfClosingElement;
}
function isJsxOpeningFragment(node) {
  return node.kind === SyntaxKind.JsxOpeningFragment;
}
function isJsxClosingFragment(node) {
  return node.kind === SyntaxKind.JsxClosingFragment;
}
function isJsxClosingElement(node) {
  return node.kind === SyntaxKind.JsxClosingElement;
}
function isSourceFile(node) {
  return node.kind === SyntaxKind.SourceFile;
}
function isExportDeclaration(node) {
  return node.kind === SyntaxKind.ExportDeclaration;
}
function isImportClause(node) {
  return node.kind === SyntaxKind.ImportClause;
}
function isTypeParameterDeclaration(node) {
  return node.kind === SyntaxKind.TypeParameter;
}
function isModuleName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.StringLiteral;
}
function isModuleExportName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.StringLiteral;
}
function isPropertyName(node) {
  const kind = node.kind;
  return kind === SyntaxKind.Identifier || kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral || kind === SyntaxKind.NumericLiteral || kind === SyntaxKind.ComputedPropertyName || kind === SyntaxKind.PrivateIdentifier || kind === SyntaxKind.BigIntLiteral;
}
function isModuleBody(node) {
  return node.kind === SyntaxKind.ModuleBlock || node.kind === SyntaxKind.ModuleDeclaration;
}
function isJSDocFullName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.ModuleDeclaration;
}
function isModuleReference(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.QualifiedName || node.kind === SyntaxKind.ExternalModuleReference;
}
function isNamedImportBindings(node) {
  return node.kind === SyntaxKind.NamespaceImport || node.kind === SyntaxKind.NamedImports;
}
function isNamedExportBindings(node) {
  return node.kind === SyntaxKind.NamespaceExport || node.kind === SyntaxKind.NamedExports;
}
function isMemberName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.PrivateIdentifier;
}
function isEntityName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.QualifiedName;
}
function isBindingName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.ObjectBindingPattern || node.kind === SyntaxKind.ArrayBindingPattern;
}
function isJsxAttributeName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.JsxNamespacedName;
}
function isJsxAttributeValue(node) {
  const kind = node.kind;
  return kind === SyntaxKind.StringLiteral || kind === SyntaxKind.JsxExpression || kind === SyntaxKind.JsxElement || kind === SyntaxKind.JsxSelfClosingElement || kind === SyntaxKind.JsxFragment;
}
function isTemplateMiddleOrTail(node) {
  return node.kind === SyntaxKind.TemplateMiddle || node.kind === SyntaxKind.TemplateTail;
}
function isTemplateLiteral(node) {
  return node.kind === SyntaxKind.TemplateExpression || node.kind === SyntaxKind.NoSubstitutionTemplateLiteral;
}
function isTypePredicateParameterName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.ThisType;
}
function isImportAttributeName(node) {
  return node.kind === SyntaxKind.Identifier || node.kind === SyntaxKind.StringLiteral;
}
function isFunctionBody(node) {
  return node.kind === SyntaxKind.Block;
}
function isAssignmentOperator(kind) {
  return kind === SyntaxKind.EqualsToken || isCompoundAssignmentOperator(kind);
}
function isBinaryOperator(kind) {
  return isAssignmentOperatorOrHigher(kind) || kind === SyntaxKind.CommaToken;
}
function isExponentiationOperator(kind) {
  return kind === SyntaxKind.AsteriskAsteriskToken;
}
function isMultiplicativeOperator(kind) {
  return kind === SyntaxKind.AsteriskToken || kind === SyntaxKind.SlashToken || kind === SyntaxKind.PercentToken;
}
function isMultiplicativeOperatorOrHigher(kind) {
  return isExponentiationOperator(kind) || isMultiplicativeOperator(kind);
}
function isAdditiveOperator(kind) {
  return kind === SyntaxKind.PlusToken || kind === SyntaxKind.MinusToken;
}
function isAdditiveOperatorOrHigher(kind) {
  return isMultiplicativeOperatorOrHigher(kind) || isAdditiveOperator(kind);
}
function isShiftOperator(kind) {
  return kind === SyntaxKind.LessThanLessThanToken || kind === SyntaxKind.GreaterThanGreaterThanToken || kind === SyntaxKind.GreaterThanGreaterThanGreaterThanToken;
}
function isShiftOperatorOrHigher(kind) {
  return isAdditiveOperatorOrHigher(kind) || isShiftOperator(kind);
}
function isRelationalOperator(kind) {
  return kind === SyntaxKind.LessThanToken || kind === SyntaxKind.LessThanEqualsToken || kind === SyntaxKind.GreaterThanToken || kind === SyntaxKind.GreaterThanEqualsToken || kind === SyntaxKind.InstanceOfKeyword || kind === SyntaxKind.InKeyword;
}
function isRelationalOperatorOrHigher(kind) {
  return isShiftOperatorOrHigher(kind) || isRelationalOperator(kind);
}
function isEqualityOperator(kind) {
  return kind === SyntaxKind.EqualsEqualsToken || kind === SyntaxKind.EqualsEqualsEqualsToken || kind === SyntaxKind.ExclamationEqualsEqualsToken || kind === SyntaxKind.ExclamationEqualsToken;
}
function isEqualityOperatorOrHigher(kind) {
  return isRelationalOperatorOrHigher(kind) || isEqualityOperator(kind);
}
function isBitwiseOperator(kind) {
  return kind === SyntaxKind.AmpersandToken || kind === SyntaxKind.BarToken || kind === SyntaxKind.CaretToken;
}
function isBitwiseOperatorOrHigher(kind) {
  return isEqualityOperatorOrHigher(kind) || isBitwiseOperator(kind);
}
function isLogicalOperator(kind) {
  return kind === SyntaxKind.AmpersandAmpersandToken || kind === SyntaxKind.BarBarToken;
}
function isLogicalOperatorOrHigher(kind) {
  return isBitwiseOperatorOrHigher(kind) || isLogicalOperator(kind);
}
function isCompoundAssignmentOperator(kind) {
  return kind === SyntaxKind.PlusEqualsToken || kind === SyntaxKind.MinusEqualsToken || kind === SyntaxKind.AsteriskAsteriskEqualsToken || kind === SyntaxKind.AsteriskEqualsToken || kind === SyntaxKind.SlashEqualsToken || kind === SyntaxKind.PercentEqualsToken || kind === SyntaxKind.AmpersandEqualsToken || kind === SyntaxKind.BarEqualsToken || kind === SyntaxKind.CaretEqualsToken || kind === SyntaxKind.LessThanLessThanEqualsToken || kind === SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken || kind === SyntaxKind.GreaterThanGreaterThanEqualsToken || kind === SyntaxKind.BarBarEqualsToken || kind === SyntaxKind.AmpersandAmpersandEqualsToken || kind === SyntaxKind.QuestionQuestionEqualsToken;
}
function isAssignmentOperatorOrHigher(kind) {
  return kind === SyntaxKind.QuestionQuestionToken || isLogicalOperatorOrHigher(kind) || isAssignmentOperator(kind);
}
function isJSDocNodeKind(kind) {
  return kind >= SyntaxKind.FirstJSDocNode && kind <= SyntaxKind.LastJSDocNode;
}
function isEndOfFile(node) {
  return node.kind === SyntaxKind.EndOfFile;
}
function isDotDotDotToken(node) {
  return node.kind === SyntaxKind.DotDotDotToken;
}
function isQuestionToken(node) {
  return node.kind === SyntaxKind.QuestionToken;
}
function isExclamationToken(node) {
  return node.kind === SyntaxKind.ExclamationToken;
}
function isColonToken(node) {
  return node.kind === SyntaxKind.ColonToken;
}
function isEqualsToken(node) {
  return node.kind === SyntaxKind.EqualsToken;
}
function isAsteriskToken(node) {
  return node.kind === SyntaxKind.AsteriskToken;
}
function isEqualsGreaterThanToken(node) {
  return node.kind === SyntaxKind.EqualsGreaterThanToken;
}
function isQuestionDotToken(node) {
  return node.kind === SyntaxKind.QuestionDotToken;
}
function isAssertsKeyword(node) {
  return node.kind === SyntaxKind.AssertsKeyword;
}
function isAwaitKeyword(node) {
  return node.kind === SyntaxKind.AwaitKeyword;
}
function isBinaryOperatorToken(node) {
  return isBinaryOperator(node.kind);
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/ast/is.js
function isTypeNode(node) {
  return isTypeNodeKind(node.kind);
}
function isTypeNodeKind(kind) {
  return kind >= SyntaxKind.FirstTypeNode && kind <= SyntaxKind.LastTypeNode || kind === SyntaxKind.AnyKeyword || kind === SyntaxKind.UnknownKeyword || kind === SyntaxKind.NumberKeyword || kind === SyntaxKind.BigIntKeyword || kind === SyntaxKind.ObjectKeyword || kind === SyntaxKind.BooleanKeyword || kind === SyntaxKind.StringKeyword || kind === SyntaxKind.SymbolKeyword || kind === SyntaxKind.VoidKeyword || kind === SyntaxKind.UndefinedKeyword || kind === SyntaxKind.NeverKeyword || kind === SyntaxKind.IntrinsicKeyword || kind === SyntaxKind.ExpressionWithTypeArguments || kind === SyntaxKind.JSDocAllType || kind === SyntaxKind.JSDocNullableType || kind === SyntaxKind.JSDocNonNullableType || kind === SyntaxKind.JSDocOptionalType || kind === SyntaxKind.JSDocVariadicType || kind === SyntaxKind.JSDocTypeExpression || kind === SyntaxKind.JSDocTypeLiteral || kind === SyntaxKind.JSDocSignature;
}
function isStatement(node) {
  const kind = node.kind;
  return kind === SyntaxKind.VariableStatement || kind === SyntaxKind.EmptyStatement || kind === SyntaxKind.ExpressionStatement || kind === SyntaxKind.IfStatement || kind === SyntaxKind.DoStatement || kind === SyntaxKind.WhileStatement || kind === SyntaxKind.ForStatement || kind === SyntaxKind.ForInStatement || kind === SyntaxKind.ForOfStatement || kind === SyntaxKind.ContinueStatement || kind === SyntaxKind.BreakStatement || kind === SyntaxKind.ReturnStatement || kind === SyntaxKind.WithStatement || kind === SyntaxKind.SwitchStatement || kind === SyntaxKind.LabeledStatement || kind === SyntaxKind.ThrowStatement || kind === SyntaxKind.TryStatement || kind === SyntaxKind.DebuggerStatement || kind === SyntaxKind.InterfaceDeclaration || kind === SyntaxKind.TypeAliasDeclaration || kind === SyntaxKind.EnumDeclaration || kind === SyntaxKind.ModuleDeclaration || kind === SyntaxKind.ImportDeclaration || kind === SyntaxKind.ImportEqualsDeclaration || kind === SyntaxKind.ExportDeclaration || kind === SyntaxKind.ExportAssignment || kind === SyntaxKind.NamespaceExportDeclaration || kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.ClassDeclaration || kind === SyntaxKind.MissingDeclaration || kind === SyntaxKind.NotEmittedStatement || kind === SyntaxKind.Block;
}
function isExpression(node) {
  const kind = node.kind;
  return kind === SyntaxKind.ConditionalExpression || kind === SyntaxKind.YieldExpression || kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.BinaryExpression || kind === SyntaxKind.SpreadElement || kind === SyntaxKind.AsExpression || kind === SyntaxKind.OmittedExpression || kind === SyntaxKind.SatisfiesExpression || kind === SyntaxKind.PrefixUnaryExpression || kind === SyntaxKind.PostfixUnaryExpression || kind === SyntaxKind.DeleteExpression || kind === SyntaxKind.TypeOfExpression || kind === SyntaxKind.VoidExpression || kind === SyntaxKind.AwaitExpression || kind === SyntaxKind.TypeAssertionExpression || kind === SyntaxKind.CallExpression || kind === SyntaxKind.NewExpression || kind === SyntaxKind.TaggedTemplateExpression || kind === SyntaxKind.NonNullExpression || kind === SyntaxKind.MetaProperty || kind === SyntaxKind.JsxExpression || kind === SyntaxKind.PropertyAccessExpression || kind === SyntaxKind.ElementAccessExpression || kind === SyntaxKind.FunctionExpression || kind === SyntaxKind.ClassExpression || kind === SyntaxKind.ParenthesizedExpression || kind === SyntaxKind.ArrayLiteralExpression || kind === SyntaxKind.ObjectLiteralExpression || kind === SyntaxKind.TemplateExpression || kind === SyntaxKind.Identifier || kind === SyntaxKind.PrivateIdentifier || kind === SyntaxKind.NumericLiteral || kind === SyntaxKind.BigIntLiteral || kind === SyntaxKind.StringLiteral || kind === SyntaxKind.RegularExpressionLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral || kind === SyntaxKind.JsxElement || kind === SyntaxKind.JsxSelfClosingElement || kind === SyntaxKind.JsxFragment || kind === SyntaxKind.NullKeyword || kind === SyntaxKind.TrueKeyword || kind === SyntaxKind.FalseKeyword || kind === SyntaxKind.ThisKeyword || kind === SyntaxKind.SuperKeyword || kind === SyntaxKind.ImportKeyword || kind === SyntaxKind.ExpressionWithTypeArguments;
}
function isLeftHandSideExpression(node) {
  return isLeftHandSideExpressionKind(skipPartiallyEmittedExpressions(node).kind);
}
function skipPartiallyEmittedExpressions(node) {
  return skipOuterExpressions(node, OuterExpressionKinds.PartiallyEmittedExpressions);
}
function isLeftHandSideExpressionKind(kind) {
  switch (kind) {
    case SyntaxKind.PropertyAccessExpression:
    case SyntaxKind.ElementAccessExpression:
    case SyntaxKind.NewExpression:
    case SyntaxKind.CallExpression:
    case SyntaxKind.JsxElement:
    case SyntaxKind.JsxSelfClosingElement:
    case SyntaxKind.JsxFragment:
    case SyntaxKind.TaggedTemplateExpression:
    case SyntaxKind.ArrayLiteralExpression:
    case SyntaxKind.ParenthesizedExpression:
    case SyntaxKind.ObjectLiteralExpression:
    case SyntaxKind.ClassExpression:
    case SyntaxKind.FunctionExpression:
    case SyntaxKind.Identifier:
    case SyntaxKind.PrivateIdentifier:
    case SyntaxKind.RegularExpressionLiteral:
    case SyntaxKind.NumericLiteral:
    case SyntaxKind.BigIntLiteral:
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
    case SyntaxKind.TemplateExpression:
    case SyntaxKind.FalseKeyword:
    case SyntaxKind.NullKeyword:
    case SyntaxKind.ThisKeyword:
    case SyntaxKind.TrueKeyword:
    case SyntaxKind.SuperKeyword:
    case SyntaxKind.NonNullExpression:
    case SyntaxKind.ExpressionWithTypeArguments:
    case SyntaxKind.MetaProperty:
    case SyntaxKind.ImportKeyword:
    case SyntaxKind.MissingDeclaration:
      return true;
    default:
      return false;
  }
}
function isOuterExpression(node, kinds = OuterExpressionKinds.All) {
  switch (node.kind) {
    case SyntaxKind.ParenthesizedExpression:
      if (kinds & OuterExpressionKinds.ExcludeJSDocTypeAssertion && isJSDocTypeAssertion(node)) {
        return false;
      }
      return (kinds & OuterExpressionKinds.Parentheses) !== 0;
    case SyntaxKind.TypeAssertionExpression:
    case SyntaxKind.AsExpression:
      return (kinds & OuterExpressionKinds.TypeAssertions) !== 0;
    case SyntaxKind.SatisfiesExpression:
      return (kinds & (OuterExpressionKinds.ExpressionsWithTypeArguments | OuterExpressionKinds.Satisfies)) !== 0;
    case SyntaxKind.ExpressionWithTypeArguments:
      return (kinds & OuterExpressionKinds.ExpressionsWithTypeArguments) !== 0;
    case SyntaxKind.NonNullExpression:
      return (kinds & OuterExpressionKinds.NonNullAssertions) !== 0;
    case SyntaxKind.PartiallyEmittedExpression:
      return (kinds & OuterExpressionKinds.PartiallyEmittedExpressions) !== 0;
  }
  return false;
}
function skipOuterExpressions(node, kinds = OuterExpressionKinds.All) {
  while (isOuterExpression(node, kinds)) {
    node = node.expression;
  }
  return node;
}
function isJSDocTypeAssertion(node) {
  const sourceFile = node.getSourceFile();
  if (sourceFile.scriptKind !== ScriptKind.JS && sourceFile.scriptKind !== ScriptKind.JSX) {
    return false;
  }
  const expression = node.expression;
  if (expression.kind !== SyntaxKind.AsExpression) {
    return false;
  }
  const asExpression = expression;
  return !!asExpression.type && (asExpression.type.flags & NodeFlags.Reparsed) !== 0;
}
function isConciseBody(node) {
  return node.kind === SyntaxKind.Block || isExpression(node);
}
function isForInitializer(node) {
  return node.kind === SyntaxKind.VariableDeclarationList || isExpression(node);
}
function isQuestionOrExclamationToken(node) {
  return node.kind === SyntaxKind.QuestionToken || node.kind === SyntaxKind.ExclamationToken;
}
function isReadonlyKeywordOrPlusOrMinusToken(node) {
  return node.kind === SyntaxKind.ReadonlyKeyword || node.kind === SyntaxKind.PlusToken || node.kind === SyntaxKind.MinusToken;
}
function isQuestionOrPlusOrMinusToken(node) {
  return node.kind === SyntaxKind.QuestionToken || node.kind === SyntaxKind.PlusToken || node.kind === SyntaxKind.MinusToken;
}
function isJsxTagNameExpression(node) {
  const kind = node.kind;
  return kind === SyntaxKind.ThisKeyword || kind === SyntaxKind.Identifier || kind === SyntaxKind.PropertyAccessExpression || kind === SyntaxKind.JsxNamespacedName;
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/ast/visitor.generated.js
function visitNode(node, visitor, test) {
  if (node === undefined)
    return;
  const visited = visitor(node);
  if (visited !== undefined && test !== undefined && !test(visited)) {
    throw new Error("Visited node failed test assertion.");
  }
  return visited;
}
function visitNodes(nodes, visitor) {
  if (nodes === undefined)
    return;
  const updated = visitNodesArray(nodes, visitor);
  if (updated === nodes) {
    return nodes;
  }
  return createNodeArray(updated, nodes.pos, nodes.end);
}
function visitNodesArray(nodes, visitor) {
  if (nodes === undefined)
    return;
  let updated;
  for (let i = 0;i < nodes.length; i++) {
    const node = nodes[i];
    const visited = visitor(node);
    if (updated) {
      if (visited)
        updated.push(visited);
    } else if (visited !== node) {
      updated = [];
      for (let j = 0;j < i; j++)
        updated.push(nodes[j]);
      if (visited)
        updated.push(visited);
    }
  }
  return updated ?? nodes;
}
var visitEachChildTable = {
  [SyntaxKind.QualifiedName]: (node, visitor) => {
    const _left = visitNode(node.left, visitor, isEntityName);
    const _right = visitNode(node.right, visitor, isIdentifier);
    return updateQualifiedName(node, _left, _right);
  },
  [SyntaxKind.ComputedPropertyName]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateComputedPropertyName(node, _expression);
  },
  [SyntaxKind.Decorator]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isLeftHandSideExpression);
    return updateDecorator(node, _expression);
  },
  [SyntaxKind.IfStatement]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _thenStatement = visitNode(node.thenStatement, visitor, isStatement);
    const _elseStatement = visitNode(node.elseStatement, visitor, isStatement);
    return updateIfStatement(node, _expression, _thenStatement, _elseStatement);
  },
  [SyntaxKind.DoStatement]: (node, visitor) => {
    const _statement = visitNode(node.statement, visitor, isStatement);
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateDoStatement(node, _statement, _expression);
  },
  [SyntaxKind.WhileStatement]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _statement = visitNode(node.statement, visitor, isStatement);
    return updateWhileStatement(node, _expression, _statement);
  },
  [SyntaxKind.ForStatement]: (node, visitor) => {
    const _initializer = visitNode(node.initializer, visitor, isForInitializer);
    const _condition = visitNode(node.condition, visitor, isExpression);
    const _incrementor = visitNode(node.incrementor, visitor, isExpression);
    const _statement = visitNode(node.statement, visitor, isStatement);
    return updateForStatement(node, _initializer, _condition, _incrementor, _statement);
  },
  [SyntaxKind.BreakStatement]: (node, visitor) => {
    const _label = visitNode(node.label, visitor, isIdentifier);
    return updateBreakStatement(node, _label);
  },
  [SyntaxKind.ContinueStatement]: (node, visitor) => {
    const _label = visitNode(node.label, visitor, isIdentifier);
    return updateContinueStatement(node, _label);
  },
  [SyntaxKind.ReturnStatement]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateReturnStatement(node, _expression);
  },
  [SyntaxKind.WithStatement]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _statement = visitNode(node.statement, visitor, isStatement);
    return updateWithStatement(node, _expression, _statement);
  },
  [SyntaxKind.SwitchStatement]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _caseBlock = visitNode(node.caseBlock, visitor, isCaseBlock);
    return updateSwitchStatement(node, _expression, _caseBlock);
  },
  [SyntaxKind.CaseBlock]: (node, visitor) => {
    const _clauses = visitNodes(node.clauses, visitor);
    return updateCaseBlock(node, _clauses);
  },
  [SyntaxKind.ThrowStatement]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateThrowStatement(node, _expression);
  },
  [SyntaxKind.TryStatement]: (node, visitor) => {
    const _tryBlock = visitNode(node.tryBlock, visitor, isBlock);
    const _catchClause = visitNode(node.catchClause, visitor, isCatchClause);
    const _finallyBlock = visitNode(node.finallyBlock, visitor, isBlock);
    return updateTryStatement(node, _tryBlock, _catchClause, _finallyBlock);
  },
  [SyntaxKind.CatchClause]: (node, visitor) => {
    const _variableDeclaration = visitNode(node.variableDeclaration, visitor, isVariableDeclaration);
    const _block = visitNode(node.block, visitor, isBlock);
    return updateCatchClause(node, _variableDeclaration, _block);
  },
  [SyntaxKind.LabeledStatement]: (node, visitor) => {
    const _label = visitNode(node.label, visitor, isIdentifier);
    const _statement = visitNode(node.statement, visitor, isStatement);
    return updateLabeledStatement(node, _label, _statement);
  },
  [SyntaxKind.ExpressionStatement]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateExpressionStatement(node, _expression);
  },
  [SyntaxKind.Block]: (node, visitor) => {
    const _statements = visitNodes(node.statements, visitor);
    return updateBlock(node, _statements);
  },
  [SyntaxKind.VariableStatement]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _declarationList = visitNode(node.declarationList, visitor, isVariableDeclarationList);
    return updateVariableStatement(node, _modifiers, _declarationList);
  },
  [SyntaxKind.VariableDeclaration]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isBindingName);
    const _exclamationToken = visitNode(node.exclamationToken, visitor, isExclamationToken);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _initializer = visitNode(node.initializer, visitor, isExpression);
    return updateVariableDeclaration(node, _name, _exclamationToken, _type, _initializer);
  },
  [SyntaxKind.VariableDeclarationList]: (node, visitor) => {
    const _declarations = visitNodes(node.declarations, visitor);
    return updateVariableDeclarationList(node, _declarations);
  },
  [SyntaxKind.Parameter]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _dotDotDotToken = visitNode(node.dotDotDotToken, visitor, isDotDotDotToken);
    const _name = visitNode(node.name, visitor, isBindingName);
    const _questionToken = visitNode(node.questionToken, visitor, isQuestionToken);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _initializer = visitNode(node.initializer, visitor, isExpression);
    return updateParameterDeclaration(node, _modifiers, _dotDotDotToken, _name, _questionToken, _type, _initializer);
  },
  [SyntaxKind.BindingElement]: (node, visitor) => {
    const _dotDotDotToken = visitNode(node.dotDotDotToken, visitor, isDotDotDotToken);
    const _propertyName = visitNode(node.propertyName, visitor, isPropertyName);
    const _name = visitNode(node.name, visitor, isBindingName);
    const _initializer = visitNode(node.initializer, visitor, isExpression);
    return updateBindingElement(node, _dotDotDotToken, _propertyName, _name, _initializer);
  },
  [SyntaxKind.MissingDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    return updateMissingDeclaration(node, _modifiers);
  },
  [SyntaxKind.FunctionDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _asteriskToken = visitNode(node.asteriskToken, visitor, isAsteriskToken);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _body = visitNode(node.body, visitor, isFunctionBody);
    return updateFunctionDeclaration(node, _modifiers, _asteriskToken, _name, _typeParameters, _parameters, _type, _body);
  },
  [SyntaxKind.ClassDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _heritageClauses = visitNodes(node.heritageClauses, visitor);
    const _members = visitNodes(node.members, visitor);
    return updateClassDeclaration(node, _modifiers, _name, _typeParameters, _heritageClauses, _members);
  },
  [SyntaxKind.ClassExpression]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _heritageClauses = visitNodes(node.heritageClauses, visitor);
    const _members = visitNodes(node.members, visitor);
    return updateClassExpression(node, _modifiers, _name, _typeParameters, _heritageClauses, _members);
  },
  [SyntaxKind.HeritageClause]: (node, visitor) => {
    const _types = visitNodes(node.types, visitor);
    return updateHeritageClause(node, _types);
  },
  [SyntaxKind.InterfaceDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _heritageClauses = visitNodes(node.heritageClauses, visitor);
    const _members = visitNodes(node.members, visitor);
    return updateInterfaceDeclaration(node, _modifiers, _name, _typeParameters, _heritageClauses, _members);
  },
  [SyntaxKind.TypeAliasDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateTypeAliasDeclaration(node, _modifiers, _name, _typeParameters, _type);
  },
  [SyntaxKind.EnumMember]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _initializer = visitNode(node.initializer, visitor, isExpression);
    return updateEnumMember(node, _name, _initializer);
  },
  [SyntaxKind.EnumDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _members = visitNodes(node.members, visitor);
    return updateEnumDeclaration(node, _modifiers, _name, _members);
  },
  [SyntaxKind.ModuleBlock]: (node, visitor) => {
    const _statements = visitNodes(node.statements, visitor);
    return updateModuleBlock(node, _statements);
  },
  [SyntaxKind.ImportDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _importClause = visitNode(node.importClause, visitor, isImportClause);
    const _moduleSpecifier = visitNode(node.moduleSpecifier, visitor, isExpression);
    const _attributes = visitNode(node.attributes, visitor, isImportAttributes);
    return updateImportDeclaration(node, _modifiers, _importClause, _moduleSpecifier, _attributes);
  },
  [SyntaxKind.ExternalModuleReference]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateExternalModuleReference(node, _expression);
  },
  [SyntaxKind.NamespaceImport]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isIdentifier);
    return updateNamespaceImport(node, _name);
  },
  [SyntaxKind.NamedImports]: (node, visitor) => {
    const _elements = visitNodes(node.elements, visitor);
    return updateNamedImports(node, _elements);
  },
  [SyntaxKind.ExportAssignment]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateExportAssignment(node, _modifiers, _type, _expression);
  },
  [SyntaxKind.NamespaceExportDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isIdentifier);
    return updateNamespaceExportDeclaration(node, _modifiers, _name);
  },
  [SyntaxKind.NamespaceExport]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isModuleExportName);
    return updateNamespaceExport(node, _name);
  },
  [SyntaxKind.NamedExports]: (node, visitor) => {
    const _elements = visitNodes(node.elements, visitor);
    return updateNamedExports(node, _elements);
  },
  [SyntaxKind.ExportSpecifier]: (node, visitor) => {
    const _propertyName = visitNode(node.propertyName, visitor, isModuleExportName);
    const _name = visitNode(node.name, visitor, isModuleExportName);
    return updateExportSpecifier(node, _propertyName, _name);
  },
  [SyntaxKind.CallSignature]: (node, visitor) => {
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateCallSignatureDeclaration(node, _typeParameters, _parameters, _type);
  },
  [SyntaxKind.ConstructSignature]: (node, visitor) => {
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateConstructSignatureDeclaration(node, _typeParameters, _parameters, _type);
  },
  [SyntaxKind.Constructor]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _body = visitNode(node.body, visitor, isFunctionBody);
    return updateConstructorDeclaration(node, _modifiers, _typeParameters, _parameters, _type, _body);
  },
  [SyntaxKind.GetAccessor]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _body = visitNode(node.body, visitor, isFunctionBody);
    return updateGetAccessorDeclaration(node, _modifiers, _name, _typeParameters, _parameters, _type, _body);
  },
  [SyntaxKind.SetAccessor]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _body = visitNode(node.body, visitor, isFunctionBody);
    return updateSetAccessorDeclaration(node, _modifiers, _name, _typeParameters, _parameters, _type, _body);
  },
  [SyntaxKind.IndexSignature]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateIndexSignatureDeclaration(node, _modifiers, _parameters, _type);
  },
  [SyntaxKind.MethodSignature]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _postfixToken = visitNode(node.postfixToken, visitor, isQuestionOrExclamationToken);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateMethodSignatureDeclaration(node, _modifiers, _name, _postfixToken, _typeParameters, _parameters, _type);
  },
  [SyntaxKind.MethodDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _asteriskToken = visitNode(node.asteriskToken, visitor, isAsteriskToken);
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _postfixToken = visitNode(node.postfixToken, visitor, isQuestionOrExclamationToken);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _body = visitNode(node.body, visitor, isFunctionBody);
    return updateMethodDeclaration(node, _modifiers, _asteriskToken, _name, _postfixToken, _typeParameters, _parameters, _type, _body);
  },
  [SyntaxKind.PropertySignature]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _postfixToken = visitNode(node.postfixToken, visitor, isQuestionOrExclamationToken);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _initializer = visitNode(node.initializer, visitor, isExpression);
    return updatePropertySignatureDeclaration(node, _modifiers, _name, _postfixToken, _type, _initializer);
  },
  [SyntaxKind.PropertyDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _postfixToken = visitNode(node.postfixToken, visitor, isQuestionOrExclamationToken);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _initializer = visitNode(node.initializer, visitor, isExpression);
    return updatePropertyDeclaration(node, _modifiers, _name, _postfixToken, _type, _initializer);
  },
  [SyntaxKind.ClassStaticBlockDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _body = visitNode(node.body, visitor, isBlock);
    return updateClassStaticBlockDeclaration(node, _modifiers, _body);
  },
  [SyntaxKind.BinaryExpression]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _left = visitNode(node.left, visitor, isExpression);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _operatorToken = visitNode(node.operatorToken, visitor, isBinaryOperatorToken);
    const _right = visitNode(node.right, visitor, isExpression);
    return updateBinaryExpression(node, _modifiers, _left, _type, _operatorToken, _right);
  },
  [SyntaxKind.PrefixUnaryExpression]: (node, visitor) => {
    const _operand = visitNode(node.operand, visitor, isExpression);
    return updatePrefixUnaryExpression(node, _operand);
  },
  [SyntaxKind.PostfixUnaryExpression]: (node, visitor) => {
    const _operand = visitNode(node.operand, visitor, isExpression);
    return updatePostfixUnaryExpression(node, _operand);
  },
  [SyntaxKind.YieldExpression]: (node, visitor) => {
    const _asteriskToken = visitNode(node.asteriskToken, visitor, isAsteriskToken);
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateYieldExpression(node, _asteriskToken, _expression);
  },
  [SyntaxKind.ArrowFunction]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _equalsGreaterThanToken = visitNode(node.equalsGreaterThanToken, visitor, isEqualsGreaterThanToken);
    const _body = visitNode(node.body, visitor, isConciseBody);
    return updateArrowFunction(node, _modifiers, _typeParameters, _parameters, _type, _equalsGreaterThanToken, _body);
  },
  [SyntaxKind.FunctionExpression]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _asteriskToken = visitNode(node.asteriskToken, visitor, isAsteriskToken);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _body = visitNode(node.body, visitor, isFunctionBody);
    return updateFunctionExpression(node, _modifiers, _asteriskToken, _name, _typeParameters, _parameters, _type, _body);
  },
  [SyntaxKind.AsExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateAsExpression(node, _expression, _type);
  },
  [SyntaxKind.SatisfiesExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateSatisfiesExpression(node, _expression, _type);
  },
  [SyntaxKind.ConditionalExpression]: (node, visitor) => {
    const _condition = visitNode(node.condition, visitor, isExpression);
    const _questionToken = visitNode(node.questionToken, visitor, isQuestionToken);
    const _whenTrue = visitNode(node.whenTrue, visitor, isExpression);
    const _colonToken = visitNode(node.colonToken, visitor, isColonToken);
    const _whenFalse = visitNode(node.whenFalse, visitor, isExpression);
    return updateConditionalExpression(node, _condition, _questionToken, _whenTrue, _colonToken, _whenFalse);
  },
  [SyntaxKind.PropertyAccessExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _questionDotToken = visitNode(node.questionDotToken, visitor, isQuestionDotToken);
    const _name = visitNode(node.name, visitor, isMemberName);
    return updatePropertyAccessExpression(node, _expression, _questionDotToken, _name);
  },
  [SyntaxKind.ElementAccessExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _questionDotToken = visitNode(node.questionDotToken, visitor, isQuestionDotToken);
    const _argumentExpression = visitNode(node.argumentExpression, visitor, isExpression);
    return updateElementAccessExpression(node, _expression, _questionDotToken, _argumentExpression);
  },
  [SyntaxKind.CallExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _questionDotToken = visitNode(node.questionDotToken, visitor, isQuestionDotToken);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    const _arguments = visitNodes(node.arguments, visitor);
    return updateCallExpression(node, _expression, _questionDotToken, _typeArguments, _arguments);
  },
  [SyntaxKind.NewExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    const _arguments = visitNodes(node.arguments, visitor);
    return updateNewExpression(node, _expression, _typeArguments, _arguments);
  },
  [SyntaxKind.MetaProperty]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isIdentifier);
    return updateMetaProperty(node, _name);
  },
  [SyntaxKind.NonNullExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateNonNullExpression(node, _expression);
  },
  [SyntaxKind.SpreadElement]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateSpreadElement(node, _expression);
  },
  [SyntaxKind.TemplateExpression]: (node, visitor) => {
    const _head = visitNode(node.head, visitor, isTemplateHead);
    const _templateSpans = visitNodes(node.templateSpans, visitor);
    return updateTemplateExpression(node, _head, _templateSpans);
  },
  [SyntaxKind.TemplateSpan]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _literal = visitNode(node.literal, visitor, isTemplateMiddleOrTail);
    return updateTemplateSpan(node, _expression, _literal);
  },
  [SyntaxKind.TaggedTemplateExpression]: (node, visitor) => {
    const _tag = visitNode(node.tag, visitor, isExpression);
    const _questionDotToken = visitNode(node.questionDotToken, visitor, isQuestionDotToken);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    const _template = visitNode(node.template, visitor, isTemplateLiteral);
    return updateTaggedTemplateExpression(node, _tag, _questionDotToken, _typeArguments, _template);
  },
  [SyntaxKind.ParenthesizedExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateParenthesizedExpression(node, _expression);
  },
  [SyntaxKind.ArrayLiteralExpression]: (node, visitor) => {
    const _elements = visitNodes(node.elements, visitor);
    return updateArrayLiteralExpression(node, _elements);
  },
  [SyntaxKind.ObjectLiteralExpression]: (node, visitor) => {
    const _properties = visitNodes(node.properties, visitor);
    return updateObjectLiteralExpression(node, _properties);
  },
  [SyntaxKind.SpreadAssignment]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateSpreadAssignment(node, _expression);
  },
  [SyntaxKind.PropertyAssignment]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _postfixToken = visitNode(node.postfixToken, visitor, isQuestionOrExclamationToken);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _initializer = visitNode(node.initializer, visitor, isExpression);
    return updatePropertyAssignment(node, _modifiers, _name, _postfixToken, _type, _initializer);
  },
  [SyntaxKind.ShorthandPropertyAssignment]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isPropertyName);
    const _postfixToken = visitNode(node.postfixToken, visitor, isQuestionOrExclamationToken);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _equalsToken = visitNode(node.equalsToken, visitor, isEqualsToken);
    const _objectAssignmentInitializer = visitNode(node.objectAssignmentInitializer, visitor, isExpression);
    return updateShorthandPropertyAssignment(node, _modifiers, _name, _postfixToken, _type, _equalsToken, _objectAssignmentInitializer);
  },
  [SyntaxKind.DeleteExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateDeleteExpression(node, _expression);
  },
  [SyntaxKind.TypeOfExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateTypeOfExpression(node, _expression);
  },
  [SyntaxKind.VoidExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateVoidExpression(node, _expression);
  },
  [SyntaxKind.AwaitExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateAwaitExpression(node, _expression);
  },
  [SyntaxKind.TypeAssertionExpression]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateTypeAssertion(node, _type, _expression);
  },
  [SyntaxKind.UnionType]: (node, visitor) => {
    const _types = visitNodes(node.types, visitor);
    return updateUnionTypeNode(node, _types);
  },
  [SyntaxKind.IntersectionType]: (node, visitor) => {
    const _types = visitNodes(node.types, visitor);
    return updateIntersectionTypeNode(node, _types);
  },
  [SyntaxKind.ConditionalType]: (node, visitor) => {
    const _checkType = visitNode(node.checkType, visitor, isTypeNode);
    const _extendsType = visitNode(node.extendsType, visitor, isTypeNode);
    const _trueType = visitNode(node.trueType, visitor, isTypeNode);
    const _falseType = visitNode(node.falseType, visitor, isTypeNode);
    return updateConditionalTypeNode(node, _checkType, _extendsType, _trueType, _falseType);
  },
  [SyntaxKind.TypeOperator]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateTypeOperatorNode(node, _type);
  },
  [SyntaxKind.InferType]: (node, visitor) => {
    const _typeParameter = visitNode(node.typeParameter, visitor, isTypeParameterDeclaration);
    return updateInferTypeNode(node, _typeParameter);
  },
  [SyntaxKind.ArrayType]: (node, visitor) => {
    const _elementType = visitNode(node.elementType, visitor, isTypeNode);
    return updateArrayTypeNode(node, _elementType);
  },
  [SyntaxKind.IndexedAccessType]: (node, visitor) => {
    const _objectType = visitNode(node.objectType, visitor, isTypeNode);
    const _indexType = visitNode(node.indexType, visitor, isTypeNode);
    return updateIndexedAccessTypeNode(node, _objectType, _indexType);
  },
  [SyntaxKind.TypeReference]: (node, visitor) => {
    const _typeName = visitNode(node.typeName, visitor, isEntityName);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    return updateTypeReferenceNode(node, _typeName, _typeArguments);
  },
  [SyntaxKind.ExpressionWithTypeArguments]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    return updateExpressionWithTypeArguments(node, _expression, _typeArguments);
  },
  [SyntaxKind.LiteralType]: (node, visitor) => {
    const _literal = visitNode(node.literal, visitor);
    return updateLiteralTypeNode(node, _literal);
  },
  [SyntaxKind.TypePredicate]: (node, visitor) => {
    const _assertsModifier = visitNode(node.assertsModifier, visitor, isAssertsKeyword);
    const _parameterName = visitNode(node.parameterName, visitor, isTypePredicateParameterName);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateTypePredicateNode(node, _assertsModifier, _parameterName, _type);
  },
  [SyntaxKind.ImportAttribute]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isImportAttributeName);
    const _value = visitNode(node.value, visitor, isExpression);
    return updateImportAttribute(node, _name, _value);
  },
  [SyntaxKind.ImportAttributes]: (node, visitor) => {
    const _attributes = visitNodes(node.attributes, visitor);
    return updateImportAttributes(node, _attributes);
  },
  [SyntaxKind.TypeQuery]: (node, visitor) => {
    const _exprName = visitNode(node.exprName, visitor, isEntityName);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    return updateTypeQueryNode(node, _exprName, _typeArguments);
  },
  [SyntaxKind.MappedType]: (node, visitor) => {
    const _readonlyToken = visitNode(node.readonlyToken, visitor, isReadonlyKeywordOrPlusOrMinusToken);
    const _typeParameter = visitNode(node.typeParameter, visitor, isTypeParameterDeclaration);
    const _nameType = visitNode(node.nameType, visitor, isTypeNode);
    const _questionToken = visitNode(node.questionToken, visitor, isQuestionOrPlusOrMinusToken);
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _members = visitNodes(node.members, visitor);
    return updateMappedTypeNode(node, _readonlyToken, _typeParameter, _nameType, _questionToken, _type, _members);
  },
  [SyntaxKind.TypeLiteral]: (node, visitor) => {
    const _members = visitNodes(node.members, visitor);
    return updateTypeLiteralNode(node, _members);
  },
  [SyntaxKind.TupleType]: (node, visitor) => {
    const _elements = visitNodes(node.elements, visitor);
    return updateTupleTypeNode(node, _elements);
  },
  [SyntaxKind.NamedTupleMember]: (node, visitor) => {
    const _dotDotDotToken = visitNode(node.dotDotDotToken, visitor, isDotDotDotToken);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _questionToken = visitNode(node.questionToken, visitor, isQuestionToken);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateNamedTupleMember(node, _dotDotDotToken, _name, _questionToken, _type);
  },
  [SyntaxKind.OptionalType]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateOptionalTypeNode(node, _type);
  },
  [SyntaxKind.RestType]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateRestTypeNode(node, _type);
  },
  [SyntaxKind.ParenthesizedType]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateParenthesizedTypeNode(node, _type);
  },
  [SyntaxKind.FunctionType]: (node, visitor) => {
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateFunctionTypeNode(node, _typeParameters, _parameters, _type);
  },
  [SyntaxKind.ConstructorType]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateConstructorTypeNode(node, _modifiers, _typeParameters, _parameters, _type);
  },
  [SyntaxKind.TemplateLiteralType]: (node, visitor) => {
    const _head = visitNode(node.head, visitor, isTemplateHead);
    const _templateSpans = visitNodes(node.templateSpans, visitor);
    return updateTemplateLiteralTypeNode(node, _head, _templateSpans);
  },
  [SyntaxKind.TemplateLiteralTypeSpan]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    const _literal = visitNode(node.literal, visitor, isTemplateMiddleOrTail);
    return updateTemplateLiteralTypeSpan(node, _type, _literal);
  },
  [SyntaxKind.SyntheticExpression]: (node, visitor) => {
    const _tupleNameSource = visitNode(node.tupleNameSource, visitor);
    return updateSyntheticExpression(node, _tupleNameSource);
  },
  [SyntaxKind.PartiallyEmittedExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updatePartiallyEmittedExpression(node, _expression);
  },
  [SyntaxKind.JsxElement]: (node, visitor) => {
    const _openingElement = visitNode(node.openingElement, visitor, isJsxOpeningElement);
    const _children = visitNodes(node.children, visitor);
    const _closingElement = visitNode(node.closingElement, visitor, isJsxClosingElement);
    return updateJsxElement(node, _openingElement, _children, _closingElement);
  },
  [SyntaxKind.JsxAttributes]: (node, visitor) => {
    const _properties = visitNodes(node.properties, visitor);
    return updateJsxAttributes(node, _properties);
  },
  [SyntaxKind.JsxNamespacedName]: (node, visitor) => {
    const _namespace = visitNode(node.namespace, visitor, isIdentifier);
    const _name = visitNode(node.name, visitor, isIdentifier);
    return updateJsxNamespacedName(node, _namespace, _name);
  },
  [SyntaxKind.JsxOpeningElement]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isJsxTagNameExpression);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    const _attributes = visitNode(node.attributes, visitor, isJsxAttributes);
    return updateJsxOpeningElement(node, _tagName, _typeArguments, _attributes);
  },
  [SyntaxKind.JsxSelfClosingElement]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isJsxTagNameExpression);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    const _attributes = visitNode(node.attributes, visitor, isJsxAttributes);
    return updateJsxSelfClosingElement(node, _tagName, _typeArguments, _attributes);
  },
  [SyntaxKind.JsxFragment]: (node, visitor) => {
    const _openingFragment = visitNode(node.openingFragment, visitor, isJsxOpeningFragment);
    const _children = visitNodes(node.children, visitor);
    const _closingFragment = visitNode(node.closingFragment, visitor, isJsxClosingFragment);
    return updateJsxFragment(node, _openingFragment, _children, _closingFragment);
  },
  [SyntaxKind.JsxAttribute]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isJsxAttributeName);
    const _initializer = visitNode(node.initializer, visitor, isJsxAttributeValue);
    return updateJsxAttribute(node, _name, _initializer);
  },
  [SyntaxKind.JsxSpreadAttribute]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateJsxSpreadAttribute(node, _expression);
  },
  [SyntaxKind.JsxClosingElement]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isJsxTagNameExpression);
    return updateJsxClosingElement(node, _tagName);
  },
  [SyntaxKind.JsxExpression]: (node, visitor) => {
    const _dotDotDotToken = visitNode(node.dotDotDotToken, visitor, isDotDotDotToken);
    const _expression = visitNode(node.expression, visitor, isExpression);
    return updateJsxExpression(node, _dotDotDotToken, _expression);
  },
  [SyntaxKind.SyntaxList]: (node, visitor) => {
    const _children = visitNodesArray(node.children, visitor);
    return updateSyntaxList(node, _children);
  },
  [SyntaxKind.JSDoc]: (node, visitor) => {
    const _comment = visitNodes(node.comment, visitor);
    const _tags = visitNodes(node.tags, visitor);
    return updateJSDoc(node, _comment, _tags);
  },
  [SyntaxKind.JSDocTypeExpression]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateJSDocTypeExpression(node, _type);
  },
  [SyntaxKind.JSDocNonNullableType]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateJSDocNonNullableType(node, _type);
  },
  [SyntaxKind.JSDocNullableType]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateJSDocNullableType(node, _type);
  },
  [SyntaxKind.JSDocVariadicType]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateJSDocVariadicType(node, _type);
  },
  [SyntaxKind.JSDocOptionalType]: (node, visitor) => {
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateJSDocOptionalType(node, _type);
  },
  [SyntaxKind.JSDocTypeTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _typeExpression = visitNode(node.typeExpression, visitor);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocTypeTag(node, _tagName, _typeExpression, _comment);
  },
  [SyntaxKind.JSDocUnknownTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocUnknownTag(node, _tagName, _comment);
  },
  [SyntaxKind.JSDocTemplateTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _constraint = visitNode(node.constraint, visitor);
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocTemplateTag(node, _tagName, _constraint, _typeParameters, _comment);
  },
  [SyntaxKind.JSDocReturnTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _typeExpression = visitNode(node.typeExpression, visitor, isTypeNode);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocReturnTag(node, _tagName, _typeExpression, _comment);
  },
  [SyntaxKind.JSDocPublicTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocPublicTag(node, _tagName, _comment);
  },
  [SyntaxKind.JSDocPrivateTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocPrivateTag(node, _tagName, _comment);
  },
  [SyntaxKind.JSDocProtectedTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocProtectedTag(node, _tagName, _comment);
  },
  [SyntaxKind.JSDocReadonlyTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocReadonlyTag(node, _tagName, _comment);
  },
  [SyntaxKind.JSDocOverrideTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocOverrideTag(node, _tagName, _comment);
  },
  [SyntaxKind.JSDocDeprecatedTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocDeprecatedTag(node, _tagName, _comment);
  },
  [SyntaxKind.JSDocSeeTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _nameExpression = visitNode(node.nameExpression, visitor, isTypeNode);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocSeeTag(node, _tagName, _nameExpression, _comment);
  },
  [SyntaxKind.JSDocImplementsTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _className = visitNode(node.className, visitor, isExpressionWithTypeArguments);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocImplementsTag(node, _tagName, _className, _comment);
  },
  [SyntaxKind.JSDocAugmentsTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _className = visitNode(node.className, visitor, isExpressionWithTypeArguments);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocAugmentsTag(node, _tagName, _className, _comment);
  },
  [SyntaxKind.JSDocSatisfiesTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _typeExpression = visitNode(node.typeExpression, visitor, isTypeNode);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocSatisfiesTag(node, _tagName, _typeExpression, _comment);
  },
  [SyntaxKind.JSDocThrowsTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _typeExpression = visitNode(node.typeExpression, visitor, isTypeNode);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocThrowsTag(node, _tagName, _typeExpression, _comment);
  },
  [SyntaxKind.JSDocThisTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _typeExpression = visitNode(node.typeExpression, visitor, isTypeNode);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocThisTag(node, _tagName, _typeExpression, _comment);
  },
  [SyntaxKind.JSDocImportTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _importClause = visitNode(node.importClause, visitor, isImportClause);
    const _moduleSpecifier = visitNode(node.moduleSpecifier, visitor, isExpression);
    const _attributes = visitNode(node.attributes, visitor, isImportAttributes);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocImportTag(node, _tagName, _importClause, _moduleSpecifier, _attributes, _comment);
  },
  [SyntaxKind.JSDocCallbackTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _typeExpression = visitNode(node.typeExpression, visitor, isTypeNode);
    const _name = visitNode(node.name, visitor, isJSDocFullName);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocCallbackTag(node, _tagName, _typeExpression, _name, _comment);
  },
  [SyntaxKind.JSDocOverloadTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _typeExpression = visitNode(node.typeExpression, visitor, isTypeNode);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocOverloadTag(node, _tagName, _typeExpression, _comment);
  },
  [SyntaxKind.JSDocTypedefTag]: (node, visitor) => {
    const _tagName = visitNode(node.tagName, visitor, isIdentifier);
    const _typeExpression = visitNode(node.typeExpression, visitor);
    const _name = visitNode(node.name, visitor, isJSDocFullName);
    const _comment = visitNodes(node.comment, visitor);
    return updateJSDocTypedefTag(node, _tagName, _typeExpression, _name, _comment);
  },
  [SyntaxKind.JSDocSignature]: (node, visitor) => {
    const _typeParameters = visitNodes(node.typeParameters, visitor);
    const _parameters = visitNodes(node.parameters, visitor);
    const _type = visitNode(node.type, visitor, isTypeNode);
    return updateJSDocSignature(node, _typeParameters, _parameters, _type);
  },
  [SyntaxKind.JSDocNameReference]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isEntityName);
    return updateJSDocNameReference(node, _name);
  },
  [SyntaxKind.SourceFile]: (node, visitor) => {
    const _statements = visitNodes(node.statements, visitor);
    const _endOfFileToken = visitNode(node.endOfFileToken, visitor, isEndOfFile);
    return updateSourceFile(node, _statements, _endOfFileToken);
  },
  [SyntaxKind.ModuleDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isModuleName);
    const _body = visitNode(node.body, visitor, isModuleBody);
    return updateModuleDeclaration(node, _modifiers, _name, _body);
  },
  [SyntaxKind.ImportEqualsDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _moduleReference = visitNode(node.moduleReference, visitor, isModuleReference);
    return updateImportEqualsDeclaration(node, _modifiers, _name, _moduleReference);
  },
  [SyntaxKind.ExportDeclaration]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _exportClause = visitNode(node.exportClause, visitor, isNamedExportBindings);
    const _moduleSpecifier = visitNode(node.moduleSpecifier, visitor, isExpression);
    const _attributes = visitNode(node.attributes, visitor, isImportAttributes);
    return updateExportDeclaration(node, _modifiers, _exportClause, _moduleSpecifier, _attributes);
  },
  [SyntaxKind.ImportType]: (node, visitor) => {
    const _argument = visitNode(node.argument, visitor, isTypeNode);
    const _attributes = visitNode(node.attributes, visitor, isImportAttributes);
    const _qualifier = visitNode(node.qualifier, visitor, isEntityName);
    const _typeArguments = visitNodes(node.typeArguments, visitor);
    return updateImportTypeNode(node, _argument, _attributes, _qualifier, _typeArguments);
  },
  [SyntaxKind.ImportClause]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _namedBindings = visitNode(node.namedBindings, visitor, isNamedImportBindings);
    return updateImportClause(node, _name, _namedBindings);
  },
  [SyntaxKind.ImportSpecifier]: (node, visitor) => {
    const _propertyName = visitNode(node.propertyName, visitor, isModuleExportName);
    const _name = visitNode(node.name, visitor, isIdentifier);
    return updateImportSpecifier(node, _propertyName, _name);
  },
  [SyntaxKind.JSDocLink]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isEntityName);
    return updateJSDocLink(node, _name);
  },
  [SyntaxKind.JSDocLinkPlain]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isEntityName);
    return updateJSDocLinkPlain(node, _name);
  },
  [SyntaxKind.JSDocLinkCode]: (node, visitor) => {
    const _name = visitNode(node.name, visitor, isEntityName);
    return updateJSDocLinkCode(node, _name);
  },
  [SyntaxKind.TypeParameter]: (node, visitor) => {
    const _modifiers = visitNodes(node.modifiers, visitor);
    const _name = visitNode(node.name, visitor, isIdentifier);
    const _constraint = visitNode(node.constraint, visitor, isTypeNode);
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _defaultType = visitNode(node.defaultType, visitor, isTypeNode);
    return updateTypeParameterDeclaration(node, _modifiers, _name, _constraint, _expression, _defaultType);
  },
  [SyntaxKind.SyntheticReferenceExpression]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _thisArg = visitNode(node.thisArg, visitor, isExpression);
    return updateSyntheticReferenceExpression(node, _expression, _thisArg);
  },
  [SyntaxKind.JSDocTypeLiteral]: (node, visitor) => {
    const _jsdocPropertyTags = visitNodesArray(node.jsdocPropertyTags, visitor);
    return updateJSDocTypeLiteral(node, _jsdocPropertyTags);
  },
  [SyntaxKind.ForInStatement]: (node, visitor) => {
    const _awaitModifier = visitNode(node.awaitModifier, visitor, isAwaitKeyword);
    const _initializer = visitNode(node.initializer, visitor, isForInitializer);
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _statement = visitNode(node.statement, visitor, isStatement);
    return updateForInStatement(node, _awaitModifier, _initializer, _expression, _statement);
  },
  [SyntaxKind.ForOfStatement]: (node, visitor) => {
    const _awaitModifier = visitNode(node.awaitModifier, visitor, isAwaitKeyword);
    const _initializer = visitNode(node.initializer, visitor, isForInitializer);
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _statement = visitNode(node.statement, visitor, isStatement);
    return updateForOfStatement(node, _awaitModifier, _initializer, _expression, _statement);
  },
  [SyntaxKind.CaseClause]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _statements = visitNodes(node.statements, visitor);
    return updateCaseClause(node, _expression, _statements);
  },
  [SyntaxKind.DefaultClause]: (node, visitor) => {
    const _expression = visitNode(node.expression, visitor, isExpression);
    const _statements = visitNodes(node.statements, visitor);
    return updateDefaultClause(node, _expression, _statements);
  },
  [SyntaxKind.ObjectBindingPattern]: (node, visitor) => {
    const _elements = visitNodes(node.elements, visitor);
    return updateObjectBindingPattern(node, _elements);
  },
  [SyntaxKind.ArrayBindingPattern]: (node, visitor) => {
    const _elements = visitNodes(node.elements, visitor);
    return updateArrayBindingPattern(node, _elements);
  },
  [SyntaxKind.JSDocParameterTag]: visitEachChildOfJSDocParameterOrPropertyTag,
  [SyntaxKind.JSDocPropertyTag]: visitEachChildOfJSDocParameterOrPropertyTag
};

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/ast/visitor.js
function visitNodeForEachChild(cbNode, node) {
  return node ? cbNode(node) : undefined;
}
function visitNodesForEachChild(cbNode, cbNodes, nodes) {
  if (!nodes)
    return;
  if (cbNodes)
    return cbNodes(nodes);
  for (const node of nodes) {
    const result = cbNode(node);
    if (result)
      return result;
  }
  return;
}
function forEachChildOfJSDocParameterOrPropertyTag(data, cbNode, cbNodes) {
  return visitNodeForEachChild(cbNode, data.tagName) || (data.isNameFirst ? visitNodeForEachChild(cbNode, data.name) || visitNodeForEachChild(cbNode, data.typeExpression) : visitNodeForEachChild(cbNode, data.typeExpression) || visitNodeForEachChild(cbNode, data.name)) || visitNodesForEachChild(cbNode, cbNodes, data.comment);
}
function visitEachChildOfJSDocParameterOrPropertyTag(node, visitor) {
  const _tagName = visitNode(node.tagName, visitor, isIdentifier);
  const _name = visitNode(node.name, visitor, isEntityName);
  const _typeExpression = visitNode(node.typeExpression, visitor, isTypeNode);
  const _comment = visitNodes(node.comment, visitor);
  return node.kind === SyntaxKind.JSDocParameterTag ? updateJSDocParameterTag(node, _tagName, _name, _typeExpression, _comment) : updateJSDocPropertyTag(node, _tagName, _name, _typeExpression, _comment);
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/ast/factory.generated.js
class NodeObject {
  kind;
  flags = 0;
  pos = -1;
  end = -1;
  parent = undefined;
  _data;
  constructor(kind, data) {
    this.kind = kind;
    this._data = data;
  }
  get ambientModuleNames() {
    return this._data?.ambientModuleNames;
  }
  get argument() {
    return this._data?.argument;
  }
  get argumentExpression() {
    return this._data?.argumentExpression;
  }
  get arguments() {
    return this._data?.arguments;
  }
  get assertsModifier() {
    return this._data?.assertsModifier;
  }
  get asteriskToken() {
    return this._data?.asteriskToken;
  }
  get attributes() {
    return this._data?.attributes;
  }
  get awaitModifier() {
    return this._data?.awaitModifier;
  }
  get block() {
    return this._data?.block;
  }
  get body() {
    return this._data?.body;
  }
  get caseBlock() {
    return this._data?.caseBlock;
  }
  get catchClause() {
    return this._data?.catchClause;
  }
  get checkType() {
    return this._data?.checkType;
  }
  get children() {
    return this._data?.children;
  }
  get className() {
    return this._data?.className;
  }
  get clauses() {
    return this._data?.clauses;
  }
  get closingElement() {
    return this._data?.closingElement;
  }
  get closingFragment() {
    return this._data?.closingFragment;
  }
  get colonToken() {
    return this._data?.colonToken;
  }
  get comment() {
    return this._data?.comment;
  }
  get condition() {
    return this._data?.condition;
  }
  get constraint() {
    return this._data?.constraint;
  }
  get containsOnlyTriviaWhiteSpaces() {
    return this._data?.containsOnlyTriviaWhiteSpaces;
  }
  get declarationList() {
    return this._data?.declarationList;
  }
  get declarations() {
    return this._data?.declarations;
  }
  get defaultType() {
    return this._data?.defaultType;
  }
  get dotDotDotToken() {
    return this._data?.dotDotDotToken;
  }
  get elementType() {
    return this._data?.elementType;
  }
  get elements() {
    return this._data?.elements;
  }
  get elseStatement() {
    return this._data?.elseStatement;
  }
  get endOfFileToken() {
    return this._data?.endOfFileToken;
  }
  get equalsGreaterThanToken() {
    return this._data?.equalsGreaterThanToken;
  }
  get equalsToken() {
    return this._data?.equalsToken;
  }
  get exclamationToken() {
    return this._data?.exclamationToken;
  }
  get exportClause() {
    return this._data?.exportClause;
  }
  get exprName() {
    return this._data?.exprName;
  }
  get expression() {
    return this._data?.expression;
  }
  get extendsType() {
    return this._data?.extendsType;
  }
  get externalModuleIndicator() {
    return this._data?.externalModuleIndicator;
  }
  get falseType() {
    return this._data?.falseType;
  }
  get fileName() {
    return this._data?.fileName;
  }
  get finallyBlock() {
    return this._data?.finallyBlock;
  }
  get head() {
    return this._data?.head;
  }
  get heritageClauses() {
    return this._data?.heritageClauses;
  }
  get importClause() {
    return this._data?.importClause;
  }
  get imports() {
    return this._data?.imports;
  }
  get incrementor() {
    return this._data?.incrementor;
  }
  get indexType() {
    return this._data?.indexType;
  }
  get initializer() {
    return this._data?.initializer;
  }
  get isArrayType() {
    return this._data?.isArrayType;
  }
  get isBracketed() {
    return this._data?.isBracketed;
  }
  get isDeclarationFile() {
    return this._data?.isDeclarationFile;
  }
  get isExportEquals() {
    return this._data?.isExportEquals;
  }
  get isNameFirst() {
    return this._data?.isNameFirst;
  }
  get isSpread() {
    return this._data?.isSpread;
  }
  get isTypeOf() {
    return this._data?.isTypeOf;
  }
  get isTypeOnly() {
    return this._data?.isTypeOnly;
  }
  get jsdocPropertyTags() {
    return this._data?.jsdocPropertyTags;
  }
  get keyword() {
    return this._data?.keyword;
  }
  get keywordToken() {
    return this._data?.keywordToken;
  }
  get label() {
    return this._data?.label;
  }
  get languageVariant() {
    return this._data?.languageVariant;
  }
  get left() {
    return this._data?.left;
  }
  get libReferenceDirectives() {
    return this._data?.libReferenceDirectives;
  }
  get literal() {
    return this._data?.literal;
  }
  get members() {
    return this._data?.members;
  }
  get modifiers() {
    return this._data?.modifiers;
  }
  get moduleAugmentations() {
    return this._data?.moduleAugmentations;
  }
  get moduleReference() {
    return this._data?.moduleReference;
  }
  get moduleSpecifier() {
    return this._data?.moduleSpecifier;
  }
  get multiLine() {
    return this._data?.multiLine;
  }
  get name() {
    return this._data?.name;
  }
  get nameExpression() {
    return this._data?.nameExpression;
  }
  get nameType() {
    return this._data?.nameType;
  }
  get namedBindings() {
    return this._data?.namedBindings;
  }
  get namespace() {
    return this._data?.namespace;
  }
  get objectAssignmentInitializer() {
    return this._data?.objectAssignmentInitializer;
  }
  get objectType() {
    return this._data?.objectType;
  }
  get openingElement() {
    return this._data?.openingElement;
  }
  get openingFragment() {
    return this._data?.openingFragment;
  }
  get operand() {
    return this._data?.operand;
  }
  get operator() {
    return this._data?.operator;
  }
  get operatorToken() {
    return this._data?.operatorToken;
  }
  get parameterName() {
    return this._data?.parameterName;
  }
  get parameters() {
    return this._data?.parameters;
  }
  get path() {
    return this._data?.path;
  }
  get phaseModifier() {
    return this._data?.phaseModifier;
  }
  get postfixToken() {
    return this._data?.postfixToken;
  }
  get properties() {
    return this._data?.properties;
  }
  get propertyName() {
    return this._data?.propertyName;
  }
  get qualifier() {
    return this._data?.qualifier;
  }
  get questionDotToken() {
    return this._data?.questionDotToken;
  }
  get questionToken() {
    return this._data?.questionToken;
  }
  get rawText() {
    return this._data?.rawText;
  }
  get readonlyToken() {
    return this._data?.readonlyToken;
  }
  get referencedFiles() {
    return this._data?.referencedFiles;
  }
  get right() {
    return this._data?.right;
  }
  get scriptKind() {
    return this._data?.scriptKind;
  }
  get statement() {
    return this._data?.statement;
  }
  get statements() {
    return this._data?.statements;
  }
  get tag() {
    return this._data?.tag;
  }
  get tagName() {
    return this._data?.tagName;
  }
  get tags() {
    return this._data?.tags;
  }
  get template() {
    return this._data?.template;
  }
  get templateFlags() {
    return this._data?.templateFlags;
  }
  get templateSpans() {
    return this._data?.templateSpans;
  }
  get text() {
    return this._data?.text;
  }
  get thenStatement() {
    return this._data?.thenStatement;
  }
  get thisArg() {
    return this._data?.thisArg;
  }
  get token() {
    return this._data?.token;
  }
  get tokenCache() {
    return this._data?.tokenCache;
  }
  get tokenFlags() {
    return this._data?.tokenFlags;
  }
  get trueType() {
    return this._data?.trueType;
  }
  get tryBlock() {
    return this._data?.tryBlock;
  }
  get tupleNameSource() {
    return this._data?.tupleNameSource;
  }
  get type() {
    return this._data?.type;
  }
  get typeArguments() {
    return this._data?.typeArguments;
  }
  get typeExpression() {
    return this._data?.typeExpression;
  }
  get typeName() {
    return this._data?.typeName;
  }
  get typeParameter() {
    return this._data?.typeParameter;
  }
  get typeParameters() {
    return this._data?.typeParameters;
  }
  get typeReferenceDirectives() {
    return this._data?.typeReferenceDirectives;
  }
  get types() {
    return this._data?.types;
  }
  get value() {
    return this._data?.value;
  }
  get variableDeclaration() {
    return this._data?.variableDeclaration;
  }
  get whenFalse() {
    return this._data?.whenFalse;
  }
  get whenTrue() {
    return this._data?.whenTrue;
  }
  forEachChild(visitor, visitArray) {
    const fn = forEachChildTable[this.kind];
    return fn ? fn(this._data, visitor, visitArray) : undefined;
  }
  getSourceFile() {
    let node = this;
    while (node.parent)
      node = node.parent;
    return node;
  }
  getStart(sourceFile, includeJsDocComment) {
    return getTokenPosOfNode(this, sourceFile ?? this.getSourceFile(), includeJsDocComment);
  }
  getFullStart() {
    return this.pos;
  }
  getEnd() {
    return this.end;
  }
  getWidth(sourceFile) {
    return this.getEnd() - this.getStart(sourceFile);
  }
  getFullWidth() {
    return this.end - this.pos;
  }
  getLeadingTriviaWidth(sourceFile) {
    return this.getStart(sourceFile) - this.pos;
  }
  getFullText(sourceFile) {
    return (sourceFile ?? this.getSourceFile()).text.substring(this.pos, this.end);
  }
  getText(sourceFile) {
    sourceFile ??= this.getSourceFile();
    return sourceFile.text.substring(this.getStart(sourceFile), this.end);
  }
}
function isNodeArray(array) {
  return "pos" in array && "end" in array;
}
function createNodeArray(elements, pos = -1, end = -1) {
  if (isNodeArray(elements))
    return elements;
  const arr = elements.slice();
  arr.pos = pos;
  arr.end = end;
  return arr;
}
var forEachChildTable = {
  [SyntaxKind.QualifiedName]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.left) || visitNode2(cbNode, data.right),
  [SyntaxKind.ComputedPropertyName]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.Decorator]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.IfStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.thenStatement) || visitNode2(cbNode, data.elseStatement),
  [SyntaxKind.DoStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.statement) || visitNode2(cbNode, data.expression),
  [SyntaxKind.WhileStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.statement),
  [SyntaxKind.ForStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.initializer) || visitNode2(cbNode, data.condition) || visitNode2(cbNode, data.incrementor) || visitNode2(cbNode, data.statement),
  [SyntaxKind.BreakStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.label),
  [SyntaxKind.ContinueStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.label),
  [SyntaxKind.ReturnStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.WithStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.statement),
  [SyntaxKind.SwitchStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.caseBlock),
  [SyntaxKind.CaseBlock]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.clauses),
  [SyntaxKind.ThrowStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.TryStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tryBlock) || visitNode2(cbNode, data.catchClause) || visitNode2(cbNode, data.finallyBlock),
  [SyntaxKind.CatchClause]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.variableDeclaration) || visitNode2(cbNode, data.block),
  [SyntaxKind.LabeledStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.label) || visitNode2(cbNode, data.statement),
  [SyntaxKind.ExpressionStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.Block]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.statements),
  [SyntaxKind.VariableStatement]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.declarationList),
  [SyntaxKind.VariableDeclaration]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name) || visitNode2(cbNode, data.exclamationToken) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.initializer),
  [SyntaxKind.VariableDeclarationList]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.declarations),
  [SyntaxKind.Parameter]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.dotDotDotToken) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.questionToken) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.initializer),
  [SyntaxKind.BindingElement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.dotDotDotToken) || visitNode2(cbNode, data.propertyName) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.initializer),
  [SyntaxKind.MissingDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers),
  [SyntaxKind.FunctionDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.asteriskToken) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.body),
  [SyntaxKind.ClassDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.heritageClauses) || visitNodes2(cbNode, cbNodes, data.members),
  [SyntaxKind.ClassExpression]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.heritageClauses) || visitNodes2(cbNode, cbNodes, data.members),
  [SyntaxKind.HeritageClause]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.types),
  [SyntaxKind.InterfaceDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.heritageClauses) || visitNodes2(cbNode, cbNodes, data.members),
  [SyntaxKind.TypeAliasDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.JSTypeAliasDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.EnumMember]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name) || visitNode2(cbNode, data.initializer),
  [SyntaxKind.EnumDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.members),
  [SyntaxKind.ModuleBlock]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.statements),
  [SyntaxKind.ImportDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.importClause) || visitNode2(cbNode, data.moduleSpecifier) || visitNode2(cbNode, data.attributes),
  [SyntaxKind.JSImportDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.importClause) || visitNode2(cbNode, data.moduleSpecifier) || visitNode2(cbNode, data.attributes),
  [SyntaxKind.ExternalModuleReference]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.NamespaceImport]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name),
  [SyntaxKind.NamedImports]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.elements),
  [SyntaxKind.ExportAssignment]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.expression),
  [SyntaxKind.NamespaceExportDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name),
  [SyntaxKind.NamespaceExport]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name),
  [SyntaxKind.NamedExports]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.elements),
  [SyntaxKind.ExportSpecifier]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.propertyName) || visitNode2(cbNode, data.name),
  [SyntaxKind.CallSignature]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.ConstructSignature]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.Constructor]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.body),
  [SyntaxKind.GetAccessor]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.body),
  [SyntaxKind.SetAccessor]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.body),
  [SyntaxKind.IndexSignature]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.MethodSignature]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.postfixToken) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.MethodDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.asteriskToken) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.postfixToken) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.body),
  [SyntaxKind.PropertySignature]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.postfixToken) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.initializer),
  [SyntaxKind.PropertyDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.postfixToken) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.initializer),
  [SyntaxKind.ClassStaticBlockDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.body),
  [SyntaxKind.BinaryExpression]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.left) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.operatorToken) || visitNode2(cbNode, data.right),
  [SyntaxKind.PrefixUnaryExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.operand),
  [SyntaxKind.PostfixUnaryExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.operand),
  [SyntaxKind.YieldExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.asteriskToken) || visitNode2(cbNode, data.expression),
  [SyntaxKind.ArrowFunction]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.equalsGreaterThanToken) || visitNode2(cbNode, data.body),
  [SyntaxKind.FunctionExpression]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.asteriskToken) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.body),
  [SyntaxKind.AsExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.type),
  [SyntaxKind.SatisfiesExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.type),
  [SyntaxKind.ConditionalExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.condition) || visitNode2(cbNode, data.questionToken) || visitNode2(cbNode, data.whenTrue) || visitNode2(cbNode, data.colonToken) || visitNode2(cbNode, data.whenFalse),
  [SyntaxKind.PropertyAccessExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.questionDotToken) || visitNode2(cbNode, data.name),
  [SyntaxKind.ElementAccessExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.questionDotToken) || visitNode2(cbNode, data.argumentExpression),
  [SyntaxKind.CallExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.questionDotToken) || visitNodes2(cbNode, cbNodes, data.typeArguments) || visitNodes2(cbNode, cbNodes, data.arguments),
  [SyntaxKind.NewExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNodes2(cbNode, cbNodes, data.typeArguments) || visitNodes2(cbNode, cbNodes, data.arguments),
  [SyntaxKind.MetaProperty]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name),
  [SyntaxKind.NonNullExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.SpreadElement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.TemplateExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.head) || visitNodes2(cbNode, cbNodes, data.templateSpans),
  [SyntaxKind.TemplateSpan]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.literal),
  [SyntaxKind.TaggedTemplateExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tag) || visitNode2(cbNode, data.questionDotToken) || visitNodes2(cbNode, cbNodes, data.typeArguments) || visitNode2(cbNode, data.template),
  [SyntaxKind.ParenthesizedExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.ArrayLiteralExpression]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.elements),
  [SyntaxKind.ObjectLiteralExpression]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.properties),
  [SyntaxKind.SpreadAssignment]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.PropertyAssignment]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.postfixToken) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.initializer),
  [SyntaxKind.ShorthandPropertyAssignment]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.postfixToken) || visitNode2(cbNode, data.type) || visitNode2(cbNode, data.equalsToken) || visitNode2(cbNode, data.objectAssignmentInitializer),
  [SyntaxKind.DeleteExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.TypeOfExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.VoidExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.AwaitExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.TypeAssertionExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type) || visitNode2(cbNode, data.expression),
  [SyntaxKind.UnionType]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.types),
  [SyntaxKind.IntersectionType]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.types),
  [SyntaxKind.ConditionalType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.checkType) || visitNode2(cbNode, data.extendsType) || visitNode2(cbNode, data.trueType) || visitNode2(cbNode, data.falseType),
  [SyntaxKind.TypeOperator]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.InferType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.typeParameter),
  [SyntaxKind.ArrayType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.elementType),
  [SyntaxKind.IndexedAccessType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.objectType) || visitNode2(cbNode, data.indexType),
  [SyntaxKind.TypeReference]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.typeName) || visitNodes2(cbNode, cbNodes, data.typeArguments),
  [SyntaxKind.ExpressionWithTypeArguments]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNodes2(cbNode, cbNodes, data.typeArguments),
  [SyntaxKind.LiteralType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.literal),
  [SyntaxKind.TypePredicate]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.assertsModifier) || visitNode2(cbNode, data.parameterName) || visitNode2(cbNode, data.type),
  [SyntaxKind.ImportAttribute]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name) || visitNode2(cbNode, data.value),
  [SyntaxKind.ImportAttributes]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.attributes),
  [SyntaxKind.TypeQuery]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.exprName) || visitNodes2(cbNode, cbNodes, data.typeArguments),
  [SyntaxKind.MappedType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.readonlyToken) || visitNode2(cbNode, data.typeParameter) || visitNode2(cbNode, data.nameType) || visitNode2(cbNode, data.questionToken) || visitNode2(cbNode, data.type) || visitNodes2(cbNode, cbNodes, data.members),
  [SyntaxKind.TypeLiteral]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.members),
  [SyntaxKind.TupleType]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.elements),
  [SyntaxKind.NamedTupleMember]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.dotDotDotToken) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.questionToken) || visitNode2(cbNode, data.type),
  [SyntaxKind.OptionalType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.RestType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.ParenthesizedType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.FunctionType]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.ConstructorType]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.TemplateLiteralType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.head) || visitNodes2(cbNode, cbNodes, data.templateSpans),
  [SyntaxKind.TemplateLiteralTypeSpan]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type) || visitNode2(cbNode, data.literal),
  [SyntaxKind.SyntheticExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tupleNameSource),
  [SyntaxKind.PartiallyEmittedExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.JsxElement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.openingElement) || visitNodes2(cbNode, cbNodes, data.children) || visitNode2(cbNode, data.closingElement),
  [SyntaxKind.JsxAttributes]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.properties),
  [SyntaxKind.JsxNamespacedName]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.namespace) || visitNode2(cbNode, data.name),
  [SyntaxKind.JsxOpeningElement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.typeArguments) || visitNode2(cbNode, data.attributes),
  [SyntaxKind.JsxSelfClosingElement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.typeArguments) || visitNode2(cbNode, data.attributes),
  [SyntaxKind.JsxFragment]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.openingFragment) || visitNodes2(cbNode, cbNodes, data.children) || visitNode2(cbNode, data.closingFragment),
  [SyntaxKind.JsxAttribute]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name) || visitNode2(cbNode, data.initializer),
  [SyntaxKind.JsxSpreadAttribute]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression),
  [SyntaxKind.JsxClosingElement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName),
  [SyntaxKind.JsxExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.dotDotDotToken) || visitNode2(cbNode, data.expression),
  [SyntaxKind.SyntaxList]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.children),
  [SyntaxKind.JSDoc]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.comment) || visitNodes2(cbNode, cbNodes, data.tags),
  [SyntaxKind.JSDocTypeExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.JSDocNonNullableType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.JSDocNullableType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.JSDocVariadicType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.JSDocOptionalType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.type),
  [SyntaxKind.JSDocTypeTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.typeExpression) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocUnknownTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocTemplateTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.constraint) || visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocReturnTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.typeExpression) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocPublicTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocPrivateTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocProtectedTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocReadonlyTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocOverrideTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocDeprecatedTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocSeeTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.nameExpression) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocImplementsTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.className) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocAugmentsTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.className) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocSatisfiesTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.typeExpression) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocThrowsTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.typeExpression) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocThisTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.typeExpression) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocImportTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.importClause) || visitNode2(cbNode, data.moduleSpecifier) || visitNode2(cbNode, data.attributes) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocCallbackTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.typeExpression) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocOverloadTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.typeExpression) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocTypedefTag]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.tagName) || visitNode2(cbNode, data.typeExpression) || visitNode2(cbNode, data.name) || visitNodes2(cbNode, cbNodes, data.comment),
  [SyntaxKind.JSDocSignature]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.typeParameters) || visitNodes2(cbNode, cbNodes, data.parameters) || visitNode2(cbNode, data.type),
  [SyntaxKind.JSDocNameReference]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name),
  [SyntaxKind.ModuleDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.body),
  [SyntaxKind.ImportEqualsDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.moduleReference),
  [SyntaxKind.ExportDeclaration]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.exportClause) || visitNode2(cbNode, data.moduleSpecifier) || visitNode2(cbNode, data.attributes),
  [SyntaxKind.ImportType]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.argument) || visitNode2(cbNode, data.attributes) || visitNode2(cbNode, data.qualifier) || visitNodes2(cbNode, cbNodes, data.typeArguments),
  [SyntaxKind.ImportClause]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name) || visitNode2(cbNode, data.namedBindings),
  [SyntaxKind.ImportSpecifier]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.propertyName) || visitNode2(cbNode, data.name),
  [SyntaxKind.JSDocLink]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name),
  [SyntaxKind.JSDocLinkPlain]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name),
  [SyntaxKind.JSDocLinkCode]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.name),
  [SyntaxKind.TypeParameter]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.modifiers) || visitNode2(cbNode, data.name) || visitNode2(cbNode, data.constraint) || visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.defaultType),
  [SyntaxKind.SyntheticReferenceExpression]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.thisArg),
  [SyntaxKind.JSDocTypeLiteral]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.jsdocPropertyTags),
  [SyntaxKind.ForInStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.awaitModifier) || visitNode2(cbNode, data.initializer) || visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.statement),
  [SyntaxKind.ForOfStatement]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.awaitModifier) || visitNode2(cbNode, data.initializer) || visitNode2(cbNode, data.expression) || visitNode2(cbNode, data.statement),
  [SyntaxKind.CaseClause]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNodes2(cbNode, cbNodes, data.statements),
  [SyntaxKind.DefaultClause]: (data, cbNode, cbNodes) => visitNode2(cbNode, data.expression) || visitNodes2(cbNode, cbNodes, data.statements),
  [SyntaxKind.ObjectBindingPattern]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.elements),
  [SyntaxKind.ArrayBindingPattern]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.elements),
  [SyntaxKind.JSDocParameterTag]: forEachChildOfJSDocParameterOrPropertyTag,
  [SyntaxKind.JSDocPropertyTag]: forEachChildOfJSDocParameterOrPropertyTag,
  [SyntaxKind.SourceFile]: (data, cbNode, cbNodes) => visitNodes2(cbNode, cbNodes, data.statements) || visitNode2(cbNode, data.endOfFileToken)
};
function visitNode2(cbNode, node) {
  return node ? cbNode(node) : undefined;
}
function visitNodes2(cbNode, cbNodes, nodes) {
  if (!nodes)
    return;
  if (cbNodes)
    return cbNodes(nodes);
  for (const node of nodes) {
    const result = cbNode(node);
    if (result)
      return result;
  }
  return;
}
function createQualifiedName(left, right) {
  return new NodeObject(SyntaxKind.QualifiedName, {
    left,
    right
  });
}
function createComputedPropertyName(expression) {
  return new NodeObject(SyntaxKind.ComputedPropertyName, {
    expression
  });
}
function createDecorator(expression) {
  return new NodeObject(SyntaxKind.Decorator, {
    expression
  });
}
function createIfStatement(expression, thenStatement, elseStatement) {
  return new NodeObject(SyntaxKind.IfStatement, {
    expression,
    thenStatement,
    elseStatement
  });
}
function createDoStatement(statement, expression) {
  return new NodeObject(SyntaxKind.DoStatement, {
    statement,
    expression
  });
}
function createWhileStatement(expression, statement) {
  return new NodeObject(SyntaxKind.WhileStatement, {
    expression,
    statement
  });
}
function createForStatement(initializer, condition, incrementor, statement) {
  return new NodeObject(SyntaxKind.ForStatement, {
    initializer,
    condition,
    incrementor,
    statement
  });
}
function createBreakStatement(label) {
  return new NodeObject(SyntaxKind.BreakStatement, {
    label
  });
}
function createContinueStatement(label) {
  return new NodeObject(SyntaxKind.ContinueStatement, {
    label
  });
}
function createReturnStatement(expression) {
  return new NodeObject(SyntaxKind.ReturnStatement, {
    expression
  });
}
function createWithStatement(expression, statement) {
  return new NodeObject(SyntaxKind.WithStatement, {
    expression,
    statement
  });
}
function createSwitchStatement(expression, caseBlock) {
  return new NodeObject(SyntaxKind.SwitchStatement, {
    expression,
    caseBlock
  });
}
function createCaseBlock(clauses) {
  return new NodeObject(SyntaxKind.CaseBlock, {
    clauses: createNodeArray(clauses)
  });
}
function createThrowStatement(expression) {
  return new NodeObject(SyntaxKind.ThrowStatement, {
    expression
  });
}
function createTryStatement(tryBlock, catchClause, finallyBlock) {
  return new NodeObject(SyntaxKind.TryStatement, {
    tryBlock,
    catchClause,
    finallyBlock
  });
}
function createCatchClause(variableDeclaration, block) {
  return new NodeObject(SyntaxKind.CatchClause, {
    variableDeclaration,
    block
  });
}
function createLabeledStatement(label, statement) {
  return new NodeObject(SyntaxKind.LabeledStatement, {
    label,
    statement
  });
}
function createExpressionStatement(expression) {
  return new NodeObject(SyntaxKind.ExpressionStatement, {
    expression
  });
}
function createBlock(statements, multiLine) {
  return new NodeObject(SyntaxKind.Block, {
    statements: createNodeArray(statements),
    multiLine
  });
}
function createVariableStatement(modifiers, declarationList) {
  return new NodeObject(SyntaxKind.VariableStatement, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    declarationList
  });
}
function createVariableDeclaration(name, exclamationToken, type, initializer) {
  return new NodeObject(SyntaxKind.VariableDeclaration, {
    name,
    exclamationToken,
    type,
    initializer
  });
}
function createVariableDeclarationList(declarations, flags) {
  const node = new NodeObject(SyntaxKind.VariableDeclarationList, {
    declarations: createNodeArray(declarations)
  });
  node.flags = flags;
  return node;
}
function createParameterDeclaration(modifiers, dotDotDotToken, name, questionToken, type, initializer) {
  return new NodeObject(SyntaxKind.Parameter, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    dotDotDotToken,
    name,
    questionToken,
    type,
    initializer
  });
}
function createBindingElement(dotDotDotToken, propertyName, name, initializer) {
  return new NodeObject(SyntaxKind.BindingElement, {
    dotDotDotToken,
    propertyName,
    name,
    initializer
  });
}
function createMissingDeclaration(modifiers) {
  return new NodeObject(SyntaxKind.MissingDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined
  });
}
function createFunctionDeclaration(modifiers, asteriskToken, name, typeParameters, parameters, type, body) {
  return new NodeObject(SyntaxKind.FunctionDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    asteriskToken,
    name,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type,
    body
  });
}
function createClassDeclaration(modifiers, name, typeParameters, heritageClauses, members) {
  return new NodeObject(SyntaxKind.ClassDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    heritageClauses: heritageClauses ? createNodeArray(heritageClauses) : undefined,
    members: createNodeArray(members)
  });
}
function createClassExpression(modifiers, name, typeParameters, heritageClauses, members) {
  return new NodeObject(SyntaxKind.ClassExpression, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    heritageClauses: heritageClauses ? createNodeArray(heritageClauses) : undefined,
    members: createNodeArray(members)
  });
}
function createHeritageClause(token, types) {
  return new NodeObject(SyntaxKind.HeritageClause, {
    token,
    types: createNodeArray(types)
  });
}
function createInterfaceDeclaration(modifiers, name, typeParameters, heritageClauses, members) {
  return new NodeObject(SyntaxKind.InterfaceDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    heritageClauses: heritageClauses ? createNodeArray(heritageClauses) : undefined,
    members: createNodeArray(members)
  });
}
function createTypeAliasDeclaration(modifiers, name, typeParameters, type) {
  return new NodeObject(SyntaxKind.TypeAliasDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    type
  });
}
function createEnumMember(name, initializer) {
  return new NodeObject(SyntaxKind.EnumMember, {
    name,
    initializer
  });
}
function createEnumDeclaration(modifiers, name, members) {
  return new NodeObject(SyntaxKind.EnumDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    members: createNodeArray(members)
  });
}
function createModuleBlock(statements) {
  return new NodeObject(SyntaxKind.ModuleBlock, {
    statements: createNodeArray(statements)
  });
}
function createImportDeclaration(modifiers, importClause, moduleSpecifier, attributes) {
  return new NodeObject(SyntaxKind.ImportDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    importClause,
    moduleSpecifier,
    attributes
  });
}
function createExternalModuleReference(expression) {
  return new NodeObject(SyntaxKind.ExternalModuleReference, {
    expression
  });
}
function createNamespaceImport(name) {
  return new NodeObject(SyntaxKind.NamespaceImport, {
    name
  });
}
function createNamedImports(elements) {
  return new NodeObject(SyntaxKind.NamedImports, {
    elements: createNodeArray(elements)
  });
}
function createExportAssignment(modifiers, isExportEquals = false, type, expression) {
  return new NodeObject(SyntaxKind.ExportAssignment, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    isExportEquals,
    type,
    expression
  });
}
function createNamespaceExportDeclaration(modifiers, name) {
  return new NodeObject(SyntaxKind.NamespaceExportDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name
  });
}
function createNamespaceExport(name) {
  return new NodeObject(SyntaxKind.NamespaceExport, {
    name
  });
}
function createNamedExports(elements) {
  return new NodeObject(SyntaxKind.NamedExports, {
    elements: createNodeArray(elements)
  });
}
function createExportSpecifier(isTypeOnly = false, propertyName, name) {
  return new NodeObject(SyntaxKind.ExportSpecifier, {
    isTypeOnly,
    propertyName,
    name
  });
}
function createCallSignatureDeclaration(typeParameters, parameters, type) {
  return new NodeObject(SyntaxKind.CallSignature, {
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type
  });
}
function createConstructSignatureDeclaration(typeParameters, parameters, type) {
  return new NodeObject(SyntaxKind.ConstructSignature, {
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type
  });
}
function createConstructorDeclaration(modifiers, typeParameters, parameters, type, body) {
  return new NodeObject(SyntaxKind.Constructor, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type,
    body
  });
}
function createGetAccessorDeclaration(modifiers, name, typeParameters, parameters, type, body) {
  return new NodeObject(SyntaxKind.GetAccessor, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type,
    body
  });
}
function createSetAccessorDeclaration(modifiers, name, typeParameters, parameters, type, body) {
  return new NodeObject(SyntaxKind.SetAccessor, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type,
    body
  });
}
function createIndexSignatureDeclaration(modifiers, parameters, type) {
  return new NodeObject(SyntaxKind.IndexSignature, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    parameters: createNodeArray(parameters),
    type
  });
}
function createMethodSignatureDeclaration(modifiers, name, postfixToken, typeParameters, parameters, type) {
  return new NodeObject(SyntaxKind.MethodSignature, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    postfixToken,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type
  });
}
function createMethodDeclaration(modifiers, asteriskToken, name, postfixToken, typeParameters, parameters, type, body) {
  return new NodeObject(SyntaxKind.MethodDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    asteriskToken,
    name,
    postfixToken,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type,
    body
  });
}
function createPropertySignatureDeclaration(modifiers, name, postfixToken, type, initializer) {
  return new NodeObject(SyntaxKind.PropertySignature, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    postfixToken,
    type,
    initializer
  });
}
function createPropertyDeclaration(modifiers, name, postfixToken, type, initializer) {
  return new NodeObject(SyntaxKind.PropertyDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    postfixToken,
    type,
    initializer
  });
}
function createClassStaticBlockDeclaration(modifiers, body) {
  return new NodeObject(SyntaxKind.ClassStaticBlockDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    body
  });
}
function createBinaryExpression(modifiers, left, type, operatorToken, right) {
  return new NodeObject(SyntaxKind.BinaryExpression, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    left,
    type,
    operatorToken,
    right
  });
}
function createPrefixUnaryExpression(operator, operand) {
  return new NodeObject(SyntaxKind.PrefixUnaryExpression, {
    operator,
    operand
  });
}
function createPostfixUnaryExpression(operand, operator) {
  return new NodeObject(SyntaxKind.PostfixUnaryExpression, {
    operand,
    operator
  });
}
function createYieldExpression(asteriskToken, expression) {
  return new NodeObject(SyntaxKind.YieldExpression, {
    asteriskToken,
    expression
  });
}
function createArrowFunction(modifiers, typeParameters, parameters, type, equalsGreaterThanToken, body) {
  return new NodeObject(SyntaxKind.ArrowFunction, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type,
    equalsGreaterThanToken,
    body
  });
}
function createFunctionExpression(modifiers, asteriskToken, name, typeParameters, parameters, type, body) {
  return new NodeObject(SyntaxKind.FunctionExpression, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    asteriskToken,
    name,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type,
    body
  });
}
function createAsExpression(expression, type) {
  return new NodeObject(SyntaxKind.AsExpression, {
    expression,
    type
  });
}
function createSatisfiesExpression(expression, type) {
  return new NodeObject(SyntaxKind.SatisfiesExpression, {
    expression,
    type
  });
}
function createConditionalExpression(condition, questionToken, whenTrue, colonToken, whenFalse) {
  return new NodeObject(SyntaxKind.ConditionalExpression, {
    condition,
    questionToken,
    whenTrue,
    colonToken,
    whenFalse
  });
}
function createPropertyAccessExpression(expression, questionDotToken, name, flags) {
  const node = new NodeObject(SyntaxKind.PropertyAccessExpression, {
    expression,
    questionDotToken,
    name
  });
  node.flags = flags;
  return node;
}
function createElementAccessExpression(expression, questionDotToken, argumentExpression, flags) {
  const node = new NodeObject(SyntaxKind.ElementAccessExpression, {
    expression,
    questionDotToken,
    argumentExpression
  });
  node.flags = flags;
  return node;
}
function createCallExpression(expression, questionDotToken, typeArguments, arguments_, flags) {
  const node = new NodeObject(SyntaxKind.CallExpression, {
    expression,
    questionDotToken,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined,
    arguments: createNodeArray(arguments_)
  });
  node.flags = flags;
  return node;
}
function createNewExpression(expression, typeArguments, arguments_) {
  return new NodeObject(SyntaxKind.NewExpression, {
    expression,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined,
    arguments: arguments_ ? createNodeArray(arguments_) : undefined
  });
}
function createMetaProperty(keywordToken, name) {
  return new NodeObject(SyntaxKind.MetaProperty, {
    keywordToken,
    name
  });
}
function createNonNullExpression(expression, flags) {
  const node = new NodeObject(SyntaxKind.NonNullExpression, {
    expression
  });
  node.flags = flags;
  return node;
}
function createSpreadElement(expression) {
  return new NodeObject(SyntaxKind.SpreadElement, {
    expression
  });
}
function createTemplateExpression(head, templateSpans) {
  return new NodeObject(SyntaxKind.TemplateExpression, {
    head,
    templateSpans: createNodeArray(templateSpans)
  });
}
function createTemplateSpan(expression, literal) {
  return new NodeObject(SyntaxKind.TemplateSpan, {
    expression,
    literal
  });
}
function createTaggedTemplateExpression(tag, questionDotToken, typeArguments, template, flags) {
  const node = new NodeObject(SyntaxKind.TaggedTemplateExpression, {
    tag,
    questionDotToken,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined,
    template
  });
  node.flags = flags;
  return node;
}
function createParenthesizedExpression(expression) {
  return new NodeObject(SyntaxKind.ParenthesizedExpression, {
    expression
  });
}
function createArrayLiteralExpression(elements, multiLine) {
  return new NodeObject(SyntaxKind.ArrayLiteralExpression, {
    elements: createNodeArray(elements),
    multiLine
  });
}
function createObjectLiteralExpression(properties, multiLine) {
  return new NodeObject(SyntaxKind.ObjectLiteralExpression, {
    properties: createNodeArray(properties),
    multiLine
  });
}
function createSpreadAssignment(expression) {
  return new NodeObject(SyntaxKind.SpreadAssignment, {
    expression
  });
}
function createPropertyAssignment(modifiers, name, postfixToken, type, initializer) {
  return new NodeObject(SyntaxKind.PropertyAssignment, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    postfixToken,
    type,
    initializer
  });
}
function createShorthandPropertyAssignment(modifiers, name, postfixToken, type, equalsToken, objectAssignmentInitializer) {
  return new NodeObject(SyntaxKind.ShorthandPropertyAssignment, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    postfixToken,
    type,
    equalsToken,
    objectAssignmentInitializer
  });
}
function createDeleteExpression(expression) {
  return new NodeObject(SyntaxKind.DeleteExpression, {
    expression
  });
}
function createTypeOfExpression(expression) {
  return new NodeObject(SyntaxKind.TypeOfExpression, {
    expression
  });
}
function createVoidExpression(expression) {
  return new NodeObject(SyntaxKind.VoidExpression, {
    expression
  });
}
function createAwaitExpression(expression) {
  return new NodeObject(SyntaxKind.AwaitExpression, {
    expression
  });
}
function createTypeAssertion(type, expression) {
  return new NodeObject(SyntaxKind.TypeAssertionExpression, {
    type,
    expression
  });
}
function createUnionTypeNode(types) {
  return new NodeObject(SyntaxKind.UnionType, {
    types: createNodeArray(types)
  });
}
function createIntersectionTypeNode(types) {
  return new NodeObject(SyntaxKind.IntersectionType, {
    types: createNodeArray(types)
  });
}
function createConditionalTypeNode(checkType, extendsType, trueType, falseType) {
  return new NodeObject(SyntaxKind.ConditionalType, {
    checkType,
    extendsType,
    trueType,
    falseType
  });
}
function createTypeOperatorNode(operator, type) {
  return new NodeObject(SyntaxKind.TypeOperator, {
    operator,
    type
  });
}
function createInferTypeNode(typeParameter) {
  return new NodeObject(SyntaxKind.InferType, {
    typeParameter
  });
}
function createArrayTypeNode(elementType) {
  return new NodeObject(SyntaxKind.ArrayType, {
    elementType
  });
}
function createIndexedAccessTypeNode(objectType, indexType) {
  return new NodeObject(SyntaxKind.IndexedAccessType, {
    objectType,
    indexType
  });
}
function createTypeReferenceNode(typeName, typeArguments) {
  return new NodeObject(SyntaxKind.TypeReference, {
    typeName,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined
  });
}
function createExpressionWithTypeArguments(expression, typeArguments) {
  return new NodeObject(SyntaxKind.ExpressionWithTypeArguments, {
    expression,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined
  });
}
function createLiteralTypeNode(literal) {
  return new NodeObject(SyntaxKind.LiteralType, {
    literal
  });
}
function createTypePredicateNode(assertsModifier, parameterName, type) {
  return new NodeObject(SyntaxKind.TypePredicate, {
    assertsModifier,
    parameterName,
    type
  });
}
function createImportAttribute(name, value) {
  return new NodeObject(SyntaxKind.ImportAttribute, {
    name,
    value
  });
}
function createImportAttributes(token, attributes, multiLine) {
  return new NodeObject(SyntaxKind.ImportAttributes, {
    token,
    attributes: createNodeArray(attributes),
    multiLine
  });
}
function createTypeQueryNode(exprName, typeArguments) {
  return new NodeObject(SyntaxKind.TypeQuery, {
    exprName,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined
  });
}
function createMappedTypeNode(readonlyToken, typeParameter, nameType, questionToken, type, members) {
  return new NodeObject(SyntaxKind.MappedType, {
    readonlyToken,
    typeParameter,
    nameType,
    questionToken,
    type,
    members: members ? createNodeArray(members) : undefined
  });
}
function createTypeLiteralNode(members) {
  return new NodeObject(SyntaxKind.TypeLiteral, {
    members: createNodeArray(members)
  });
}
function createTupleTypeNode(elements) {
  return new NodeObject(SyntaxKind.TupleType, {
    elements: createNodeArray(elements)
  });
}
function createNamedTupleMember(dotDotDotToken, name, questionToken, type) {
  return new NodeObject(SyntaxKind.NamedTupleMember, {
    dotDotDotToken,
    name,
    questionToken,
    type
  });
}
function createOptionalTypeNode(type) {
  return new NodeObject(SyntaxKind.OptionalType, {
    type
  });
}
function createRestTypeNode(type) {
  return new NodeObject(SyntaxKind.RestType, {
    type
  });
}
function createParenthesizedTypeNode(type) {
  return new NodeObject(SyntaxKind.ParenthesizedType, {
    type
  });
}
function createFunctionTypeNode(typeParameters, parameters, type) {
  return new NodeObject(SyntaxKind.FunctionType, {
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type
  });
}
function createConstructorTypeNode(modifiers, typeParameters, parameters, type) {
  return new NodeObject(SyntaxKind.ConstructorType, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type
  });
}
function createTemplateLiteralTypeNode(head, templateSpans) {
  return new NodeObject(SyntaxKind.TemplateLiteralType, {
    head,
    templateSpans: createNodeArray(templateSpans)
  });
}
function createTemplateLiteralTypeSpan(type, literal) {
  return new NodeObject(SyntaxKind.TemplateLiteralTypeSpan, {
    type,
    literal
  });
}
function createSyntheticExpression(type, isSpread, tupleNameSource) {
  return new NodeObject(SyntaxKind.SyntheticExpression, {
    type,
    isSpread,
    tupleNameSource
  });
}
function createPartiallyEmittedExpression(expression) {
  return new NodeObject(SyntaxKind.PartiallyEmittedExpression, {
    expression
  });
}
function createJsxElement(openingElement, children, closingElement) {
  return new NodeObject(SyntaxKind.JsxElement, {
    openingElement,
    children: createNodeArray(children),
    closingElement
  });
}
function createJsxAttributes(properties) {
  return new NodeObject(SyntaxKind.JsxAttributes, {
    properties: createNodeArray(properties)
  });
}
function createJsxNamespacedName(namespace, name) {
  return new NodeObject(SyntaxKind.JsxNamespacedName, {
    namespace,
    name
  });
}
function createJsxOpeningElement(tagName, typeArguments, attributes) {
  return new NodeObject(SyntaxKind.JsxOpeningElement, {
    tagName,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined,
    attributes
  });
}
function createJsxSelfClosingElement(tagName, typeArguments, attributes) {
  return new NodeObject(SyntaxKind.JsxSelfClosingElement, {
    tagName,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined,
    attributes
  });
}
function createJsxFragment(openingFragment, children, closingFragment) {
  return new NodeObject(SyntaxKind.JsxFragment, {
    openingFragment,
    children: createNodeArray(children),
    closingFragment
  });
}
function createJsxAttribute(name, initializer) {
  return new NodeObject(SyntaxKind.JsxAttribute, {
    name,
    initializer
  });
}
function createJsxSpreadAttribute(expression) {
  return new NodeObject(SyntaxKind.JsxSpreadAttribute, {
    expression
  });
}
function createJsxClosingElement(tagName) {
  return new NodeObject(SyntaxKind.JsxClosingElement, {
    tagName
  });
}
function createJsxExpression(dotDotDotToken, expression) {
  return new NodeObject(SyntaxKind.JsxExpression, {
    dotDotDotToken,
    expression
  });
}
function createSyntaxList(children) {
  return new NodeObject(SyntaxKind.SyntaxList, {
    children
  });
}
function createJSDoc(comment, tags) {
  return new NodeObject(SyntaxKind.JSDoc, {
    comment: createNodeArray(comment),
    tags: tags ? createNodeArray(tags) : undefined
  });
}
function createJSDocTypeExpression(type) {
  return new NodeObject(SyntaxKind.JSDocTypeExpression, {
    type
  });
}
function createJSDocNonNullableType(type) {
  return new NodeObject(SyntaxKind.JSDocNonNullableType, {
    type
  });
}
function createJSDocNullableType(type) {
  return new NodeObject(SyntaxKind.JSDocNullableType, {
    type
  });
}
function createJSDocVariadicType(type) {
  return new NodeObject(SyntaxKind.JSDocVariadicType, {
    type
  });
}
function createJSDocOptionalType(type) {
  return new NodeObject(SyntaxKind.JSDocOptionalType, {
    type
  });
}
function createJSDocTypeTag(tagName, typeExpression, comment) {
  return new NodeObject(SyntaxKind.JSDocTypeTag, {
    tagName,
    typeExpression,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocUnknownTag(tagName, comment) {
  return new NodeObject(SyntaxKind.JSDocUnknownTag, {
    tagName,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocTemplateTag(tagName, constraint, typeParameters, comment) {
  return new NodeObject(SyntaxKind.JSDocTemplateTag, {
    tagName,
    constraint,
    typeParameters: createNodeArray(typeParameters),
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocReturnTag(tagName, typeExpression, comment) {
  return new NodeObject(SyntaxKind.JSDocReturnTag, {
    tagName,
    typeExpression,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocPublicTag(tagName, comment) {
  return new NodeObject(SyntaxKind.JSDocPublicTag, {
    tagName,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocPrivateTag(tagName, comment) {
  return new NodeObject(SyntaxKind.JSDocPrivateTag, {
    tagName,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocProtectedTag(tagName, comment) {
  return new NodeObject(SyntaxKind.JSDocProtectedTag, {
    tagName,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocReadonlyTag(tagName, comment) {
  return new NodeObject(SyntaxKind.JSDocReadonlyTag, {
    tagName,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocOverrideTag(tagName, comment) {
  return new NodeObject(SyntaxKind.JSDocOverrideTag, {
    tagName,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocDeprecatedTag(tagName, comment) {
  return new NodeObject(SyntaxKind.JSDocDeprecatedTag, {
    tagName,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocSeeTag(tagName, nameExpression, comment) {
  return new NodeObject(SyntaxKind.JSDocSeeTag, {
    tagName,
    nameExpression,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocImplementsTag(tagName, className, comment) {
  return new NodeObject(SyntaxKind.JSDocImplementsTag, {
    tagName,
    className,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocAugmentsTag(tagName, className, comment) {
  return new NodeObject(SyntaxKind.JSDocAugmentsTag, {
    tagName,
    className,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocSatisfiesTag(tagName, typeExpression, comment) {
  return new NodeObject(SyntaxKind.JSDocSatisfiesTag, {
    tagName,
    typeExpression,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocThrowsTag(tagName, typeExpression, comment) {
  return new NodeObject(SyntaxKind.JSDocThrowsTag, {
    tagName,
    typeExpression,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocThisTag(tagName, typeExpression, comment) {
  return new NodeObject(SyntaxKind.JSDocThisTag, {
    tagName,
    typeExpression,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocImportTag(tagName, importClause, moduleSpecifier, attributes, comment) {
  return new NodeObject(SyntaxKind.JSDocImportTag, {
    tagName,
    importClause,
    moduleSpecifier,
    attributes,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocCallbackTag(tagName, typeExpression, name, comment) {
  return new NodeObject(SyntaxKind.JSDocCallbackTag, {
    tagName,
    typeExpression,
    name,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocOverloadTag(tagName, typeExpression, comment) {
  return new NodeObject(SyntaxKind.JSDocOverloadTag, {
    tagName,
    typeExpression,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocTypedefTag(tagName, typeExpression, name, comment) {
  return new NodeObject(SyntaxKind.JSDocTypedefTag, {
    tagName,
    typeExpression,
    name,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocSignature(typeParameters, parameters, type) {
  return new NodeObject(SyntaxKind.JSDocSignature, {
    typeParameters: typeParameters ? createNodeArray(typeParameters) : undefined,
    parameters: createNodeArray(parameters),
    type
  });
}
function createJSDocNameReference(name) {
  return new NodeObject(SyntaxKind.JSDocNameReference, {
    name
  });
}
function createModuleDeclaration(modifiers, keyword, name, body) {
  return new NodeObject(SyntaxKind.ModuleDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    keyword,
    name,
    body
  });
}
function createImportEqualsDeclaration(modifiers, isTypeOnly = false, name, moduleReference) {
  return new NodeObject(SyntaxKind.ImportEqualsDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    isTypeOnly,
    name,
    moduleReference
  });
}
function createExportDeclaration(modifiers, isTypeOnly, exportClause, moduleSpecifier, attributes) {
  return new NodeObject(SyntaxKind.ExportDeclaration, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    isTypeOnly,
    exportClause,
    moduleSpecifier,
    attributes
  });
}
function createImportTypeNode(isTypeOf = false, argument, attributes, qualifier, typeArguments) {
  return new NodeObject(SyntaxKind.ImportType, {
    isTypeOf,
    argument,
    attributes,
    qualifier,
    typeArguments: typeArguments ? createNodeArray(typeArguments) : undefined
  });
}
function createImportClause(phaseModifier, name, namedBindings) {
  return new NodeObject(SyntaxKind.ImportClause, {
    phaseModifier,
    name,
    namedBindings
  });
}
function createImportSpecifier(isTypeOnly = false, propertyName, name) {
  return new NodeObject(SyntaxKind.ImportSpecifier, {
    isTypeOnly,
    propertyName,
    name
  });
}
function createJSDocLink(name, text) {
  return new NodeObject(SyntaxKind.JSDocLink, {
    name,
    text
  });
}
function createJSDocLinkPlain(name, text) {
  return new NodeObject(SyntaxKind.JSDocLinkPlain, {
    name,
    text
  });
}
function createJSDocLinkCode(name, text) {
  return new NodeObject(SyntaxKind.JSDocLinkCode, {
    name,
    text
  });
}
function createTypeParameterDeclaration(modifiers, name, constraint, expression, defaultType) {
  return new NodeObject(SyntaxKind.TypeParameter, {
    modifiers: modifiers ? createNodeArray(modifiers) : undefined,
    name,
    constraint,
    expression,
    defaultType
  });
}
function createSyntheticReferenceExpression(expression, thisArg) {
  return new NodeObject(SyntaxKind.SyntheticReferenceExpression, {
    expression,
    thisArg
  });
}
function createJSDocTypeLiteral(jsdocPropertyTags, isArrayType) {
  return new NodeObject(SyntaxKind.JSDocTypeLiteral, {
    jsdocPropertyTags,
    isArrayType
  });
}
function createForInStatement(awaitModifier, initializer, expression, statement) {
  return new NodeObject(SyntaxKind.ForInStatement, {
    awaitModifier,
    initializer,
    expression,
    statement
  });
}
function createForOfStatement(awaitModifier, initializer, expression, statement) {
  return new NodeObject(SyntaxKind.ForOfStatement, {
    awaitModifier,
    initializer,
    expression,
    statement
  });
}
function createCaseClause(expression, statements) {
  return new NodeObject(SyntaxKind.CaseClause, {
    expression,
    statements: createNodeArray(statements)
  });
}
function createDefaultClause(expression, statements) {
  return new NodeObject(SyntaxKind.DefaultClause, {
    expression,
    statements: createNodeArray(statements)
  });
}
function createObjectBindingPattern(elements) {
  return new NodeObject(SyntaxKind.ObjectBindingPattern, {
    elements: createNodeArray(elements)
  });
}
function createArrayBindingPattern(elements) {
  return new NodeObject(SyntaxKind.ArrayBindingPattern, {
    elements: createNodeArray(elements)
  });
}
function createJSDocParameterTag(tagName, name, isBracketed, typeExpression, isNameFirst, comment) {
  return new NodeObject(SyntaxKind.JSDocParameterTag, {
    tagName,
    name,
    isBracketed,
    typeExpression,
    isNameFirst,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function createJSDocPropertyTag(tagName, name, isBracketed, typeExpression, isNameFirst, comment) {
  return new NodeObject(SyntaxKind.JSDocPropertyTag, {
    tagName,
    name,
    isBracketed,
    typeExpression,
    isNameFirst,
    comment: comment ? createNodeArray(comment) : undefined
  });
}
function updateQualifiedName(node, left, right) {
  return node.left !== left || node.right !== right ? createQualifiedName(left, right) : node;
}
function updateComputedPropertyName(node, expression) {
  return node.expression !== expression ? createComputedPropertyName(expression) : node;
}
function updateDecorator(node, expression) {
  return node.expression !== expression ? createDecorator(expression) : node;
}
function updateIfStatement(node, expression, thenStatement, elseStatement) {
  return node.expression !== expression || node.thenStatement !== thenStatement || node.elseStatement !== elseStatement ? createIfStatement(expression, thenStatement, elseStatement) : node;
}
function updateDoStatement(node, statement, expression) {
  return node.statement !== statement || node.expression !== expression ? createDoStatement(statement, expression) : node;
}
function updateWhileStatement(node, expression, statement) {
  return node.expression !== expression || node.statement !== statement ? createWhileStatement(expression, statement) : node;
}
function updateForStatement(node, initializer, condition, incrementor, statement) {
  return node.initializer !== initializer || node.condition !== condition || node.incrementor !== incrementor || node.statement !== statement ? createForStatement(initializer, condition, incrementor, statement) : node;
}
function updateBreakStatement(node, label) {
  return node.label !== label ? createBreakStatement(label) : node;
}
function updateContinueStatement(node, label) {
  return node.label !== label ? createContinueStatement(label) : node;
}
function updateReturnStatement(node, expression) {
  return node.expression !== expression ? createReturnStatement(expression) : node;
}
function updateWithStatement(node, expression, statement) {
  return node.expression !== expression || node.statement !== statement ? createWithStatement(expression, statement) : node;
}
function updateSwitchStatement(node, expression, caseBlock) {
  return node.expression !== expression || node.caseBlock !== caseBlock ? createSwitchStatement(expression, caseBlock) : node;
}
function updateCaseBlock(node, clauses) {
  return node.clauses !== clauses ? createCaseBlock(clauses) : node;
}
function updateThrowStatement(node, expression) {
  return node.expression !== expression ? createThrowStatement(expression) : node;
}
function updateTryStatement(node, tryBlock, catchClause, finallyBlock) {
  return node.tryBlock !== tryBlock || node.catchClause !== catchClause || node.finallyBlock !== finallyBlock ? createTryStatement(tryBlock, catchClause, finallyBlock) : node;
}
function updateCatchClause(node, variableDeclaration, block) {
  return node.variableDeclaration !== variableDeclaration || node.block !== block ? createCatchClause(variableDeclaration, block) : node;
}
function updateLabeledStatement(node, label, statement) {
  return node.label !== label || node.statement !== statement ? createLabeledStatement(label, statement) : node;
}
function updateExpressionStatement(node, expression) {
  return node.expression !== expression ? createExpressionStatement(expression) : node;
}
function updateBlock(node, statements) {
  return node.statements !== statements ? createBlock(statements, node.multiLine) : node;
}
function updateVariableStatement(node, modifiers, declarationList) {
  return node.modifiers !== modifiers || node.declarationList !== declarationList ? createVariableStatement(modifiers, declarationList) : node;
}
function updateVariableDeclaration(node, name, exclamationToken, type, initializer) {
  return node.name !== name || node.exclamationToken !== exclamationToken || node.type !== type || node.initializer !== initializer ? createVariableDeclaration(name, exclamationToken, type, initializer) : node;
}
function updateVariableDeclarationList(node, declarations) {
  return node.declarations !== declarations ? createVariableDeclarationList(declarations, node.flags) : node;
}
function updateParameterDeclaration(node, modifiers, dotDotDotToken, name, questionToken, type, initializer) {
  return node.modifiers !== modifiers || node.dotDotDotToken !== dotDotDotToken || node.name !== name || node.questionToken !== questionToken || node.type !== type || node.initializer !== initializer ? createParameterDeclaration(modifiers, dotDotDotToken, name, questionToken, type, initializer) : node;
}
function updateBindingElement(node, dotDotDotToken, propertyName, name, initializer) {
  return node.dotDotDotToken !== dotDotDotToken || node.propertyName !== propertyName || node.name !== name || node.initializer !== initializer ? createBindingElement(dotDotDotToken, propertyName, name, initializer) : node;
}
function updateMissingDeclaration(node, modifiers) {
  return node.modifiers !== modifiers ? createMissingDeclaration(modifiers) : node;
}
function updateFunctionDeclaration(node, modifiers, asteriskToken, name, typeParameters, parameters, type, body) {
  return node.modifiers !== modifiers || node.asteriskToken !== asteriskToken || node.name !== name || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type || node.body !== body ? createFunctionDeclaration(modifiers, asteriskToken, name, typeParameters, parameters, type, body) : node;
}
function updateClassDeclaration(node, modifiers, name, typeParameters, heritageClauses, members) {
  return node.modifiers !== modifiers || node.name !== name || node.typeParameters !== typeParameters || node.heritageClauses !== heritageClauses || node.members !== members ? createClassDeclaration(modifiers, name, typeParameters, heritageClauses, members) : node;
}
function updateClassExpression(node, modifiers, name, typeParameters, heritageClauses, members) {
  return node.modifiers !== modifiers || node.name !== name || node.typeParameters !== typeParameters || node.heritageClauses !== heritageClauses || node.members !== members ? createClassExpression(modifiers, name, typeParameters, heritageClauses, members) : node;
}
function updateHeritageClause(node, types) {
  return node.types !== types ? createHeritageClause(node.token, types) : node;
}
function updateInterfaceDeclaration(node, modifiers, name, typeParameters, heritageClauses, members) {
  return node.modifiers !== modifiers || node.name !== name || node.typeParameters !== typeParameters || node.heritageClauses !== heritageClauses || node.members !== members ? createInterfaceDeclaration(modifiers, name, typeParameters, heritageClauses, members) : node;
}
function updateTypeAliasDeclaration(node, modifiers, name, typeParameters, type) {
  return node.modifiers !== modifiers || node.name !== name || node.typeParameters !== typeParameters || node.type !== type ? createTypeAliasDeclaration(modifiers, name, typeParameters, type) : node;
}
function updateEnumMember(node, name, initializer) {
  return node.name !== name || node.initializer !== initializer ? createEnumMember(name, initializer) : node;
}
function updateEnumDeclaration(node, modifiers, name, members) {
  return node.modifiers !== modifiers || node.name !== name || node.members !== members ? createEnumDeclaration(modifiers, name, members) : node;
}
function updateModuleBlock(node, statements) {
  return node.statements !== statements ? createModuleBlock(statements) : node;
}
function updateImportDeclaration(node, modifiers, importClause, moduleSpecifier, attributes) {
  return node.modifiers !== modifiers || node.importClause !== importClause || node.moduleSpecifier !== moduleSpecifier || node.attributes !== attributes ? createImportDeclaration(modifiers, importClause, moduleSpecifier, attributes) : node;
}
function updateExternalModuleReference(node, expression) {
  return node.expression !== expression ? createExternalModuleReference(expression) : node;
}
function updateNamespaceImport(node, name) {
  return node.name !== name ? createNamespaceImport(name) : node;
}
function updateNamedImports(node, elements) {
  return node.elements !== elements ? createNamedImports(elements) : node;
}
function updateExportAssignment(node, modifiers, type, expression) {
  return node.modifiers !== modifiers || node.type !== type || node.expression !== expression ? createExportAssignment(modifiers, node.isExportEquals, type, expression) : node;
}
function updateNamespaceExportDeclaration(node, modifiers, name) {
  return node.modifiers !== modifiers || node.name !== name ? createNamespaceExportDeclaration(modifiers, name) : node;
}
function updateNamespaceExport(node, name) {
  return node.name !== name ? createNamespaceExport(name) : node;
}
function updateNamedExports(node, elements) {
  return node.elements !== elements ? createNamedExports(elements) : node;
}
function updateExportSpecifier(node, propertyName, name) {
  return node.propertyName !== propertyName || node.name !== name ? createExportSpecifier(node.isTypeOnly, propertyName, name) : node;
}
function updateCallSignatureDeclaration(node, typeParameters, parameters, type) {
  return node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type ? createCallSignatureDeclaration(typeParameters, parameters, type) : node;
}
function updateConstructSignatureDeclaration(node, typeParameters, parameters, type) {
  return node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type ? createConstructSignatureDeclaration(typeParameters, parameters, type) : node;
}
function updateConstructorDeclaration(node, modifiers, typeParameters, parameters, type, body) {
  return node.modifiers !== modifiers || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type || node.body !== body ? createConstructorDeclaration(modifiers, typeParameters, parameters, type, body) : node;
}
function updateGetAccessorDeclaration(node, modifiers, name, typeParameters, parameters, type, body) {
  return node.modifiers !== modifiers || node.name !== name || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type || node.body !== body ? createGetAccessorDeclaration(modifiers, name, typeParameters, parameters, type, body) : node;
}
function updateSetAccessorDeclaration(node, modifiers, name, typeParameters, parameters, type, body) {
  return node.modifiers !== modifiers || node.name !== name || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type || node.body !== body ? createSetAccessorDeclaration(modifiers, name, typeParameters, parameters, type, body) : node;
}
function updateIndexSignatureDeclaration(node, modifiers, parameters, type) {
  return node.modifiers !== modifiers || node.parameters !== parameters || node.type !== type ? createIndexSignatureDeclaration(modifiers, parameters, type) : node;
}
function updateMethodSignatureDeclaration(node, modifiers, name, postfixToken, typeParameters, parameters, type) {
  return node.modifiers !== modifiers || node.name !== name || node.postfixToken !== postfixToken || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type ? createMethodSignatureDeclaration(modifiers, name, postfixToken, typeParameters, parameters, type) : node;
}
function updateMethodDeclaration(node, modifiers, asteriskToken, name, postfixToken, typeParameters, parameters, type, body) {
  return node.modifiers !== modifiers || node.asteriskToken !== asteriskToken || node.name !== name || node.postfixToken !== postfixToken || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type || node.body !== body ? createMethodDeclaration(modifiers, asteriskToken, name, postfixToken, typeParameters, parameters, type, body) : node;
}
function updatePropertySignatureDeclaration(node, modifiers, name, postfixToken, type, initializer) {
  return node.modifiers !== modifiers || node.name !== name || node.postfixToken !== postfixToken || node.type !== type || node.initializer !== initializer ? createPropertySignatureDeclaration(modifiers, name, postfixToken, type, initializer) : node;
}
function updatePropertyDeclaration(node, modifiers, name, postfixToken, type, initializer) {
  return node.modifiers !== modifiers || node.name !== name || node.postfixToken !== postfixToken || node.type !== type || node.initializer !== initializer ? createPropertyDeclaration(modifiers, name, postfixToken, type, initializer) : node;
}
function updateClassStaticBlockDeclaration(node, modifiers, body) {
  return node.modifiers !== modifiers || node.body !== body ? createClassStaticBlockDeclaration(modifiers, body) : node;
}
function updateBinaryExpression(node, modifiers, left, type, operatorToken, right) {
  return node.modifiers !== modifiers || node.left !== left || node.type !== type || node.operatorToken !== operatorToken || node.right !== right ? createBinaryExpression(modifiers, left, type, operatorToken, right) : node;
}
function updatePrefixUnaryExpression(node, operand) {
  return node.operand !== operand ? createPrefixUnaryExpression(node.operator, operand) : node;
}
function updatePostfixUnaryExpression(node, operand) {
  return node.operand !== operand ? createPostfixUnaryExpression(operand, node.operator) : node;
}
function updateYieldExpression(node, asteriskToken, expression) {
  return node.asteriskToken !== asteriskToken || node.expression !== expression ? createYieldExpression(asteriskToken, expression) : node;
}
function updateArrowFunction(node, modifiers, typeParameters, parameters, type, equalsGreaterThanToken, body) {
  return node.modifiers !== modifiers || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type || node.equalsGreaterThanToken !== equalsGreaterThanToken || node.body !== body ? createArrowFunction(modifiers, typeParameters, parameters, type, equalsGreaterThanToken, body) : node;
}
function updateFunctionExpression(node, modifiers, asteriskToken, name, typeParameters, parameters, type, body) {
  return node.modifiers !== modifiers || node.asteriskToken !== asteriskToken || node.name !== name || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type || node.body !== body ? createFunctionExpression(modifiers, asteriskToken, name, typeParameters, parameters, type, body) : node;
}
function updateAsExpression(node, expression, type) {
  return node.expression !== expression || node.type !== type ? createAsExpression(expression, type) : node;
}
function updateSatisfiesExpression(node, expression, type) {
  return node.expression !== expression || node.type !== type ? createSatisfiesExpression(expression, type) : node;
}
function updateConditionalExpression(node, condition, questionToken, whenTrue, colonToken, whenFalse) {
  return node.condition !== condition || node.questionToken !== questionToken || node.whenTrue !== whenTrue || node.colonToken !== colonToken || node.whenFalse !== whenFalse ? createConditionalExpression(condition, questionToken, whenTrue, colonToken, whenFalse) : node;
}
function updatePropertyAccessExpression(node, expression, questionDotToken, name) {
  return node.expression !== expression || node.questionDotToken !== questionDotToken || node.name !== name ? createPropertyAccessExpression(expression, questionDotToken, name, node.flags) : node;
}
function updateElementAccessExpression(node, expression, questionDotToken, argumentExpression) {
  return node.expression !== expression || node.questionDotToken !== questionDotToken || node.argumentExpression !== argumentExpression ? createElementAccessExpression(expression, questionDotToken, argumentExpression, node.flags) : node;
}
function updateCallExpression(node, expression, questionDotToken, typeArguments, arguments_) {
  return node.expression !== expression || node.questionDotToken !== questionDotToken || node.typeArguments !== typeArguments || node.arguments !== arguments_ ? createCallExpression(expression, questionDotToken, typeArguments, arguments_, node.flags) : node;
}
function updateNewExpression(node, expression, typeArguments, arguments_) {
  return node.expression !== expression || node.typeArguments !== typeArguments || node.arguments !== arguments_ ? createNewExpression(expression, typeArguments, arguments_) : node;
}
function updateMetaProperty(node, name) {
  return node.name !== name ? createMetaProperty(node.keywordToken, name) : node;
}
function updateNonNullExpression(node, expression) {
  return node.expression !== expression ? createNonNullExpression(expression, node.flags) : node;
}
function updateSpreadElement(node, expression) {
  return node.expression !== expression ? createSpreadElement(expression) : node;
}
function updateTemplateExpression(node, head, templateSpans) {
  return node.head !== head || node.templateSpans !== templateSpans ? createTemplateExpression(head, templateSpans) : node;
}
function updateTemplateSpan(node, expression, literal) {
  return node.expression !== expression || node.literal !== literal ? createTemplateSpan(expression, literal) : node;
}
function updateTaggedTemplateExpression(node, tag, questionDotToken, typeArguments, template) {
  return node.tag !== tag || node.questionDotToken !== questionDotToken || node.typeArguments !== typeArguments || node.template !== template ? createTaggedTemplateExpression(tag, questionDotToken, typeArguments, template, node.flags) : node;
}
function updateParenthesizedExpression(node, expression) {
  return node.expression !== expression ? createParenthesizedExpression(expression) : node;
}
function updateArrayLiteralExpression(node, elements) {
  return node.elements !== elements ? createArrayLiteralExpression(elements, node.multiLine) : node;
}
function updateObjectLiteralExpression(node, properties) {
  return node.properties !== properties ? createObjectLiteralExpression(properties, node.multiLine) : node;
}
function updateSpreadAssignment(node, expression) {
  return node.expression !== expression ? createSpreadAssignment(expression) : node;
}
function updatePropertyAssignment(node, modifiers, name, postfixToken, type, initializer) {
  return node.modifiers !== modifiers || node.name !== name || node.postfixToken !== postfixToken || node.type !== type || node.initializer !== initializer ? createPropertyAssignment(modifiers, name, postfixToken, type, initializer) : node;
}
function updateShorthandPropertyAssignment(node, modifiers, name, postfixToken, type, equalsToken, objectAssignmentInitializer) {
  return node.modifiers !== modifiers || node.name !== name || node.postfixToken !== postfixToken || node.type !== type || node.equalsToken !== equalsToken || node.objectAssignmentInitializer !== objectAssignmentInitializer ? createShorthandPropertyAssignment(modifiers, name, postfixToken, type, equalsToken, objectAssignmentInitializer) : node;
}
function updateDeleteExpression(node, expression) {
  return node.expression !== expression ? createDeleteExpression(expression) : node;
}
function updateTypeOfExpression(node, expression) {
  return node.expression !== expression ? createTypeOfExpression(expression) : node;
}
function updateVoidExpression(node, expression) {
  return node.expression !== expression ? createVoidExpression(expression) : node;
}
function updateAwaitExpression(node, expression) {
  return node.expression !== expression ? createAwaitExpression(expression) : node;
}
function updateTypeAssertion(node, type, expression) {
  return node.type !== type || node.expression !== expression ? createTypeAssertion(type, expression) : node;
}
function updateUnionTypeNode(node, types) {
  return node.types !== types ? createUnionTypeNode(types) : node;
}
function updateIntersectionTypeNode(node, types) {
  return node.types !== types ? createIntersectionTypeNode(types) : node;
}
function updateConditionalTypeNode(node, checkType, extendsType, trueType, falseType) {
  return node.checkType !== checkType || node.extendsType !== extendsType || node.trueType !== trueType || node.falseType !== falseType ? createConditionalTypeNode(checkType, extendsType, trueType, falseType) : node;
}
function updateTypeOperatorNode(node, type) {
  return node.type !== type ? createTypeOperatorNode(node.operator, type) : node;
}
function updateInferTypeNode(node, typeParameter) {
  return node.typeParameter !== typeParameter ? createInferTypeNode(typeParameter) : node;
}
function updateArrayTypeNode(node, elementType) {
  return node.elementType !== elementType ? createArrayTypeNode(elementType) : node;
}
function updateIndexedAccessTypeNode(node, objectType, indexType) {
  return node.objectType !== objectType || node.indexType !== indexType ? createIndexedAccessTypeNode(objectType, indexType) : node;
}
function updateTypeReferenceNode(node, typeName, typeArguments) {
  return node.typeName !== typeName || node.typeArguments !== typeArguments ? createTypeReferenceNode(typeName, typeArguments) : node;
}
function updateExpressionWithTypeArguments(node, expression, typeArguments) {
  return node.expression !== expression || node.typeArguments !== typeArguments ? createExpressionWithTypeArguments(expression, typeArguments) : node;
}
function updateLiteralTypeNode(node, literal) {
  return node.literal !== literal ? createLiteralTypeNode(literal) : node;
}
function updateTypePredicateNode(node, assertsModifier, parameterName, type) {
  return node.assertsModifier !== assertsModifier || node.parameterName !== parameterName || node.type !== type ? createTypePredicateNode(assertsModifier, parameterName, type) : node;
}
function updateImportAttribute(node, name, value) {
  return node.name !== name || node.value !== value ? createImportAttribute(name, value) : node;
}
function updateImportAttributes(node, attributes) {
  return node.attributes !== attributes ? createImportAttributes(node.token, attributes, node.multiLine) : node;
}
function updateTypeQueryNode(node, exprName, typeArguments) {
  return node.exprName !== exprName || node.typeArguments !== typeArguments ? createTypeQueryNode(exprName, typeArguments) : node;
}
function updateMappedTypeNode(node, readonlyToken, typeParameter, nameType, questionToken, type, members) {
  return node.readonlyToken !== readonlyToken || node.typeParameter !== typeParameter || node.nameType !== nameType || node.questionToken !== questionToken || node.type !== type || node.members !== members ? createMappedTypeNode(readonlyToken, typeParameter, nameType, questionToken, type, members) : node;
}
function updateTypeLiteralNode(node, members) {
  return node.members !== members ? createTypeLiteralNode(members) : node;
}
function updateTupleTypeNode(node, elements) {
  return node.elements !== elements ? createTupleTypeNode(elements) : node;
}
function updateNamedTupleMember(node, dotDotDotToken, name, questionToken, type) {
  return node.dotDotDotToken !== dotDotDotToken || node.name !== name || node.questionToken !== questionToken || node.type !== type ? createNamedTupleMember(dotDotDotToken, name, questionToken, type) : node;
}
function updateOptionalTypeNode(node, type) {
  return node.type !== type ? createOptionalTypeNode(type) : node;
}
function updateRestTypeNode(node, type) {
  return node.type !== type ? createRestTypeNode(type) : node;
}
function updateParenthesizedTypeNode(node, type) {
  return node.type !== type ? createParenthesizedTypeNode(type) : node;
}
function updateFunctionTypeNode(node, typeParameters, parameters, type) {
  return node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type ? createFunctionTypeNode(typeParameters, parameters, type) : node;
}
function updateConstructorTypeNode(node, modifiers, typeParameters, parameters, type) {
  return node.modifiers !== modifiers || node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type ? createConstructorTypeNode(modifiers, typeParameters, parameters, type) : node;
}
function updateTemplateLiteralTypeNode(node, head, templateSpans) {
  return node.head !== head || node.templateSpans !== templateSpans ? createTemplateLiteralTypeNode(head, templateSpans) : node;
}
function updateTemplateLiteralTypeSpan(node, type, literal) {
  return node.type !== type || node.literal !== literal ? createTemplateLiteralTypeSpan(type, literal) : node;
}
function updateSyntheticExpression(node, tupleNameSource) {
  return node.tupleNameSource !== tupleNameSource ? createSyntheticExpression(node.type, node.isSpread, tupleNameSource) : node;
}
function updatePartiallyEmittedExpression(node, expression) {
  return node.expression !== expression ? createPartiallyEmittedExpression(expression) : node;
}
function updateJsxElement(node, openingElement, children, closingElement) {
  return node.openingElement !== openingElement || node.children !== children || node.closingElement !== closingElement ? createJsxElement(openingElement, children, closingElement) : node;
}
function updateJsxAttributes(node, properties) {
  return node.properties !== properties ? createJsxAttributes(properties) : node;
}
function updateJsxNamespacedName(node, namespace, name) {
  return node.namespace !== namespace || node.name !== name ? createJsxNamespacedName(namespace, name) : node;
}
function updateJsxOpeningElement(node, tagName, typeArguments, attributes) {
  return node.tagName !== tagName || node.typeArguments !== typeArguments || node.attributes !== attributes ? createJsxOpeningElement(tagName, typeArguments, attributes) : node;
}
function updateJsxSelfClosingElement(node, tagName, typeArguments, attributes) {
  return node.tagName !== tagName || node.typeArguments !== typeArguments || node.attributes !== attributes ? createJsxSelfClosingElement(tagName, typeArguments, attributes) : node;
}
function updateJsxFragment(node, openingFragment, children, closingFragment) {
  return node.openingFragment !== openingFragment || node.children !== children || node.closingFragment !== closingFragment ? createJsxFragment(openingFragment, children, closingFragment) : node;
}
function updateJsxAttribute(node, name, initializer) {
  return node.name !== name || node.initializer !== initializer ? createJsxAttribute(name, initializer) : node;
}
function updateJsxSpreadAttribute(node, expression) {
  return node.expression !== expression ? createJsxSpreadAttribute(expression) : node;
}
function updateJsxClosingElement(node, tagName) {
  return node.tagName !== tagName ? createJsxClosingElement(tagName) : node;
}
function updateJsxExpression(node, dotDotDotToken, expression) {
  return node.dotDotDotToken !== dotDotDotToken || node.expression !== expression ? createJsxExpression(dotDotDotToken, expression) : node;
}
function updateSyntaxList(node, children) {
  return node.children !== children ? createSyntaxList(children) : node;
}
function updateJSDoc(node, comment, tags) {
  return node.comment !== comment || node.tags !== tags ? createJSDoc(comment, tags) : node;
}
function updateJSDocTypeExpression(node, type) {
  return node.type !== type ? createJSDocTypeExpression(type) : node;
}
function updateJSDocNonNullableType(node, type) {
  return node.type !== type ? createJSDocNonNullableType(type) : node;
}
function updateJSDocNullableType(node, type) {
  return node.type !== type ? createJSDocNullableType(type) : node;
}
function updateJSDocVariadicType(node, type) {
  return node.type !== type ? createJSDocVariadicType(type) : node;
}
function updateJSDocOptionalType(node, type) {
  return node.type !== type ? createJSDocOptionalType(type) : node;
}
function updateJSDocTypeTag(node, tagName, typeExpression, comment) {
  return node.tagName !== tagName || node.typeExpression !== typeExpression || node.comment !== comment ? createJSDocTypeTag(tagName, typeExpression, comment) : node;
}
function updateJSDocUnknownTag(node, tagName, comment) {
  return node.tagName !== tagName || node.comment !== comment ? createJSDocUnknownTag(tagName, comment) : node;
}
function updateJSDocTemplateTag(node, tagName, constraint, typeParameters, comment) {
  return node.tagName !== tagName || node.constraint !== constraint || node.typeParameters !== typeParameters || node.comment !== comment ? createJSDocTemplateTag(tagName, constraint, typeParameters, comment) : node;
}
function updateJSDocReturnTag(node, tagName, typeExpression, comment) {
  return node.tagName !== tagName || node.typeExpression !== typeExpression || node.comment !== comment ? createJSDocReturnTag(tagName, typeExpression, comment) : node;
}
function updateJSDocPublicTag(node, tagName, comment) {
  return node.tagName !== tagName || node.comment !== comment ? createJSDocPublicTag(tagName, comment) : node;
}
function updateJSDocPrivateTag(node, tagName, comment) {
  return node.tagName !== tagName || node.comment !== comment ? createJSDocPrivateTag(tagName, comment) : node;
}
function updateJSDocProtectedTag(node, tagName, comment) {
  return node.tagName !== tagName || node.comment !== comment ? createJSDocProtectedTag(tagName, comment) : node;
}
function updateJSDocReadonlyTag(node, tagName, comment) {
  return node.tagName !== tagName || node.comment !== comment ? createJSDocReadonlyTag(tagName, comment) : node;
}
function updateJSDocOverrideTag(node, tagName, comment) {
  return node.tagName !== tagName || node.comment !== comment ? createJSDocOverrideTag(tagName, comment) : node;
}
function updateJSDocDeprecatedTag(node, tagName, comment) {
  return node.tagName !== tagName || node.comment !== comment ? createJSDocDeprecatedTag(tagName, comment) : node;
}
function updateJSDocSeeTag(node, tagName, nameExpression, comment) {
  return node.tagName !== tagName || node.nameExpression !== nameExpression || node.comment !== comment ? createJSDocSeeTag(tagName, nameExpression, comment) : node;
}
function updateJSDocImplementsTag(node, tagName, className, comment) {
  return node.tagName !== tagName || node.className !== className || node.comment !== comment ? createJSDocImplementsTag(tagName, className, comment) : node;
}
function updateJSDocAugmentsTag(node, tagName, className, comment) {
  return node.tagName !== tagName || node.className !== className || node.comment !== comment ? createJSDocAugmentsTag(tagName, className, comment) : node;
}
function updateJSDocSatisfiesTag(node, tagName, typeExpression, comment) {
  return node.tagName !== tagName || node.typeExpression !== typeExpression || node.comment !== comment ? createJSDocSatisfiesTag(tagName, typeExpression, comment) : node;
}
function updateJSDocThrowsTag(node, tagName, typeExpression, comment) {
  return node.tagName !== tagName || node.typeExpression !== typeExpression || node.comment !== comment ? createJSDocThrowsTag(tagName, typeExpression, comment) : node;
}
function updateJSDocThisTag(node, tagName, typeExpression, comment) {
  return node.tagName !== tagName || node.typeExpression !== typeExpression || node.comment !== comment ? createJSDocThisTag(tagName, typeExpression, comment) : node;
}
function updateJSDocImportTag(node, tagName, importClause, moduleSpecifier, attributes, comment) {
  return node.tagName !== tagName || node.importClause !== importClause || node.moduleSpecifier !== moduleSpecifier || node.attributes !== attributes || node.comment !== comment ? createJSDocImportTag(tagName, importClause, moduleSpecifier, attributes, comment) : node;
}
function updateJSDocCallbackTag(node, tagName, typeExpression, name, comment) {
  return node.tagName !== tagName || node.typeExpression !== typeExpression || node.name !== name || node.comment !== comment ? createJSDocCallbackTag(tagName, typeExpression, name, comment) : node;
}
function updateJSDocOverloadTag(node, tagName, typeExpression, comment) {
  return node.tagName !== tagName || node.typeExpression !== typeExpression || node.comment !== comment ? createJSDocOverloadTag(tagName, typeExpression, comment) : node;
}
function updateJSDocTypedefTag(node, tagName, typeExpression, name, comment) {
  return node.tagName !== tagName || node.typeExpression !== typeExpression || node.name !== name || node.comment !== comment ? createJSDocTypedefTag(tagName, typeExpression, name, comment) : node;
}
function updateJSDocSignature(node, typeParameters, parameters, type) {
  return node.typeParameters !== typeParameters || node.parameters !== parameters || node.type !== type ? createJSDocSignature(typeParameters, parameters, type) : node;
}
function updateJSDocNameReference(node, name) {
  return node.name !== name ? createJSDocNameReference(name) : node;
}
function updateModuleDeclaration(node, modifiers, name, body) {
  return node.modifiers !== modifiers || node.name !== name || node.body !== body ? createModuleDeclaration(modifiers, node.keyword, name, body) : node;
}
function updateImportEqualsDeclaration(node, modifiers, name, moduleReference) {
  return node.modifiers !== modifiers || node.name !== name || node.moduleReference !== moduleReference ? createImportEqualsDeclaration(modifiers, node.isTypeOnly, name, moduleReference) : node;
}
function updateExportDeclaration(node, modifiers, exportClause, moduleSpecifier, attributes) {
  return node.modifiers !== modifiers || node.exportClause !== exportClause || node.moduleSpecifier !== moduleSpecifier || node.attributes !== attributes ? createExportDeclaration(modifiers, node.isTypeOnly, exportClause, moduleSpecifier, attributes) : node;
}
function updateImportTypeNode(node, argument, attributes, qualifier, typeArguments) {
  return node.argument !== argument || node.attributes !== attributes || node.qualifier !== qualifier || node.typeArguments !== typeArguments ? createImportTypeNode(node.isTypeOf, argument, attributes, qualifier, typeArguments) : node;
}
function updateImportClause(node, name, namedBindings) {
  return node.name !== name || node.namedBindings !== namedBindings ? createImportClause(node.phaseModifier, name, namedBindings) : node;
}
function updateImportSpecifier(node, propertyName, name) {
  return node.propertyName !== propertyName || node.name !== name ? createImportSpecifier(node.isTypeOnly, propertyName, name) : node;
}
function updateJSDocLink(node, name) {
  return node.name !== name ? createJSDocLink(name, node.text) : node;
}
function updateJSDocLinkPlain(node, name) {
  return node.name !== name ? createJSDocLinkPlain(name, node.text) : node;
}
function updateJSDocLinkCode(node, name) {
  return node.name !== name ? createJSDocLinkCode(name, node.text) : node;
}
function updateTypeParameterDeclaration(node, modifiers, name, constraint, expression, defaultType) {
  return node.modifiers !== modifiers || node.name !== name || node.constraint !== constraint || node.expression !== expression || node.defaultType !== defaultType ? createTypeParameterDeclaration(modifiers, name, constraint, expression, defaultType) : node;
}
function updateSyntheticReferenceExpression(node, expression, thisArg) {
  return node.expression !== expression || node.thisArg !== thisArg ? createSyntheticReferenceExpression(expression, thisArg) : node;
}
function updateJSDocTypeLiteral(node, jsdocPropertyTags) {
  return node.jsdocPropertyTags !== jsdocPropertyTags ? createJSDocTypeLiteral(jsdocPropertyTags, node.isArrayType) : node;
}
function updateForInStatement(node, awaitModifier, initializer, expression, statement) {
  return node.awaitModifier !== awaitModifier || node.initializer !== initializer || node.expression !== expression || node.statement !== statement ? createForInStatement(awaitModifier, initializer, expression, statement) : node;
}
function updateForOfStatement(node, awaitModifier, initializer, expression, statement) {
  return node.awaitModifier !== awaitModifier || node.initializer !== initializer || node.expression !== expression || node.statement !== statement ? createForOfStatement(awaitModifier, initializer, expression, statement) : node;
}
function updateCaseClause(node, expression, statements) {
  return node.expression !== expression || node.statements !== statements ? createCaseClause(expression, statements) : node;
}
function updateDefaultClause(node, expression, statements) {
  return node.expression !== expression || node.statements !== statements ? createDefaultClause(expression, statements) : node;
}
function updateObjectBindingPattern(node, elements) {
  return node.elements !== elements ? createObjectBindingPattern(elements) : node;
}
function updateArrayBindingPattern(node, elements) {
  return node.elements !== elements ? createArrayBindingPattern(elements) : node;
}
function updateJSDocParameterTag(node, tagName, name, typeExpression, comment) {
  return node.tagName !== tagName || node.name !== name || node.typeExpression !== typeExpression || node.comment !== comment ? createJSDocParameterTag(tagName, name, node.isBracketed, typeExpression, node.isNameFirst, comment) : node;
}
function updateJSDocPropertyTag(node, tagName, name, typeExpression, comment) {
  return node.tagName !== tagName || node.name !== name || node.typeExpression !== typeExpression || node.comment !== comment ? createJSDocPropertyTag(tagName, name, node.isBracketed, typeExpression, node.isNameFirst, comment) : node;
}
function cloneSourceFileWithChanges(source, statements, endOfFileToken) {
  return new NodeObject(SyntaxKind.SourceFile, {
    ...cloneSourceFileData(source),
    statements: createNodeArray(statements),
    endOfFileToken
  });
}
function updateSourceFile(node, statements, endOfFileToken) {
  return node.statements !== statements || node.endOfFileToken !== endOfFileToken ? cloneSourceFileWithChanges(node, statements, endOfFileToken) : node;
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/ast/scanner.js
var EscapeSequenceScanningFlags = {
  String: 1 << 0,
  ReportErrors: 1 << 1,
  RegularExpression: 1 << 2,
  AnnexB: 1 << 3,
  AnyUnicodeMode: 1 << 4,
  AtomEscape: 1 << 5,
  ReportInvalidEscapeErrors: 1 << 2 | 1 << 1,
  AllowExtendedUnicodeEscape: 1 << 0 | 1 << 4
};
var textToKeywordObj = {
  abstract: SyntaxKind.AbstractKeyword,
  accessor: SyntaxKind.AccessorKeyword,
  any: SyntaxKind.AnyKeyword,
  as: SyntaxKind.AsKeyword,
  asserts: SyntaxKind.AssertsKeyword,
  assert: SyntaxKind.AssertKeyword,
  bigint: SyntaxKind.BigIntKeyword,
  boolean: SyntaxKind.BooleanKeyword,
  break: SyntaxKind.BreakKeyword,
  case: SyntaxKind.CaseKeyword,
  catch: SyntaxKind.CatchKeyword,
  class: SyntaxKind.ClassKeyword,
  continue: SyntaxKind.ContinueKeyword,
  const: SyntaxKind.ConstKeyword,
  ["" + "constructor"]: SyntaxKind.ConstructorKeyword,
  debugger: SyntaxKind.DebuggerKeyword,
  declare: SyntaxKind.DeclareKeyword,
  default: SyntaxKind.DefaultKeyword,
  defer: SyntaxKind.DeferKeyword,
  delete: SyntaxKind.DeleteKeyword,
  do: SyntaxKind.DoKeyword,
  else: SyntaxKind.ElseKeyword,
  enum: SyntaxKind.EnumKeyword,
  export: SyntaxKind.ExportKeyword,
  extends: SyntaxKind.ExtendsKeyword,
  false: SyntaxKind.FalseKeyword,
  finally: SyntaxKind.FinallyKeyword,
  for: SyntaxKind.ForKeyword,
  from: SyntaxKind.FromKeyword,
  function: SyntaxKind.FunctionKeyword,
  get: SyntaxKind.GetKeyword,
  if: SyntaxKind.IfKeyword,
  implements: SyntaxKind.ImplementsKeyword,
  import: SyntaxKind.ImportKeyword,
  in: SyntaxKind.InKeyword,
  infer: SyntaxKind.InferKeyword,
  instanceof: SyntaxKind.InstanceOfKeyword,
  interface: SyntaxKind.InterfaceKeyword,
  intrinsic: SyntaxKind.IntrinsicKeyword,
  is: SyntaxKind.IsKeyword,
  keyof: SyntaxKind.KeyOfKeyword,
  let: SyntaxKind.LetKeyword,
  module: SyntaxKind.ModuleKeyword,
  namespace: SyntaxKind.NamespaceKeyword,
  never: SyntaxKind.NeverKeyword,
  new: SyntaxKind.NewKeyword,
  null: SyntaxKind.NullKeyword,
  number: SyntaxKind.NumberKeyword,
  object: SyntaxKind.ObjectKeyword,
  package: SyntaxKind.PackageKeyword,
  private: SyntaxKind.PrivateKeyword,
  protected: SyntaxKind.ProtectedKeyword,
  public: SyntaxKind.PublicKeyword,
  override: SyntaxKind.OverrideKeyword,
  out: SyntaxKind.OutKeyword,
  readonly: SyntaxKind.ReadonlyKeyword,
  require: SyntaxKind.RequireKeyword,
  global: SyntaxKind.GlobalKeyword,
  return: SyntaxKind.ReturnKeyword,
  satisfies: SyntaxKind.SatisfiesKeyword,
  set: SyntaxKind.SetKeyword,
  static: SyntaxKind.StaticKeyword,
  string: SyntaxKind.StringKeyword,
  super: SyntaxKind.SuperKeyword,
  switch: SyntaxKind.SwitchKeyword,
  symbol: SyntaxKind.SymbolKeyword,
  this: SyntaxKind.ThisKeyword,
  throw: SyntaxKind.ThrowKeyword,
  true: SyntaxKind.TrueKeyword,
  try: SyntaxKind.TryKeyword,
  type: SyntaxKind.TypeKeyword,
  typeof: SyntaxKind.TypeOfKeyword,
  undefined: SyntaxKind.UndefinedKeyword,
  unique: SyntaxKind.UniqueKeyword,
  unknown: SyntaxKind.UnknownKeyword,
  using: SyntaxKind.UsingKeyword,
  var: SyntaxKind.VarKeyword,
  void: SyntaxKind.VoidKeyword,
  while: SyntaxKind.WhileKeyword,
  with: SyntaxKind.WithKeyword,
  yield: SyntaxKind.YieldKeyword,
  async: SyntaxKind.AsyncKeyword,
  await: SyntaxKind.AwaitKeyword,
  of: SyntaxKind.OfKeyword
};
var textToKeyword = new Map(Object.entries(textToKeywordObj));
var textToToken = new Map(Object.entries({
  ...textToKeywordObj,
  "{": SyntaxKind.OpenBraceToken,
  "}": SyntaxKind.CloseBraceToken,
  "(": SyntaxKind.OpenParenToken,
  ")": SyntaxKind.CloseParenToken,
  "[": SyntaxKind.OpenBracketToken,
  "]": SyntaxKind.CloseBracketToken,
  ".": SyntaxKind.DotToken,
  "...": SyntaxKind.DotDotDotToken,
  ";": SyntaxKind.SemicolonToken,
  ",": SyntaxKind.CommaToken,
  "<": SyntaxKind.LessThanToken,
  ">": SyntaxKind.GreaterThanToken,
  "<=": SyntaxKind.LessThanEqualsToken,
  ">=": SyntaxKind.GreaterThanEqualsToken,
  "==": SyntaxKind.EqualsEqualsToken,
  "!=": SyntaxKind.ExclamationEqualsToken,
  "===": SyntaxKind.EqualsEqualsEqualsToken,
  "!==": SyntaxKind.ExclamationEqualsEqualsToken,
  "=>": SyntaxKind.EqualsGreaterThanToken,
  "+": SyntaxKind.PlusToken,
  "-": SyntaxKind.MinusToken,
  "**": SyntaxKind.AsteriskAsteriskToken,
  "*": SyntaxKind.AsteriskToken,
  "/": SyntaxKind.SlashToken,
  "%": SyntaxKind.PercentToken,
  "++": SyntaxKind.PlusPlusToken,
  "--": SyntaxKind.MinusMinusToken,
  "<<": SyntaxKind.LessThanLessThanToken,
  "</": SyntaxKind.LessThanSlashToken,
  ">>": SyntaxKind.GreaterThanGreaterThanToken,
  ">>>": SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  "&": SyntaxKind.AmpersandToken,
  "|": SyntaxKind.BarToken,
  "^": SyntaxKind.CaretToken,
  "!": SyntaxKind.ExclamationToken,
  "~": SyntaxKind.TildeToken,
  "&&": SyntaxKind.AmpersandAmpersandToken,
  "||": SyntaxKind.BarBarToken,
  "?": SyntaxKind.QuestionToken,
  "??": SyntaxKind.QuestionQuestionToken,
  "?.": SyntaxKind.QuestionDotToken,
  ":": SyntaxKind.ColonToken,
  "=": SyntaxKind.EqualsToken,
  "+=": SyntaxKind.PlusEqualsToken,
  "-=": SyntaxKind.MinusEqualsToken,
  "*=": SyntaxKind.AsteriskEqualsToken,
  "**=": SyntaxKind.AsteriskAsteriskEqualsToken,
  "/=": SyntaxKind.SlashEqualsToken,
  "%=": SyntaxKind.PercentEqualsToken,
  "<<=": SyntaxKind.LessThanLessThanEqualsToken,
  ">>=": SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ">>>=": SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  "&=": SyntaxKind.AmpersandEqualsToken,
  "|=": SyntaxKind.BarEqualsToken,
  "^=": SyntaxKind.CaretEqualsToken,
  "||=": SyntaxKind.BarBarEqualsToken,
  "&&=": SyntaxKind.AmpersandAmpersandEqualsToken,
  "??=": SyntaxKind.QuestionQuestionEqualsToken,
  "@": SyntaxKind.AtToken,
  "#": SyntaxKind.HashToken,
  "`": SyntaxKind.BacktickToken
}));
var charCodeToRegExpFlag = new Map([
  [CharacterCodes.d, RegularExpressionFlags.HasIndices],
  [CharacterCodes.g, RegularExpressionFlags.Global],
  [CharacterCodes.i, RegularExpressionFlags.IgnoreCase],
  [CharacterCodes.m, RegularExpressionFlags.Multiline],
  [CharacterCodes.s, RegularExpressionFlags.DotAll],
  [CharacterCodes.u, RegularExpressionFlags.Unicode],
  [CharacterCodes.v, RegularExpressionFlags.UnicodeSets],
  [CharacterCodes.y, RegularExpressionFlags.Sticky]
]);
var jsDocTagTerminators = new Set([" ", "\t", `
`, "\r", "}", "*"]);
function makeReverseMap(source) {
  const result = [];
  source.forEach((value, name) => {
    result[value] = name;
  });
  return result;
}
var tokenStrings = makeReverseMap(textToToken);
function computeLineStarts(text) {
  const result = [];
  let pos = 0;
  let lineStart = 0;
  while (pos < text.length) {
    const ch = text.charCodeAt(pos);
    pos++;
    switch (ch) {
      case CharacterCodes.carriageReturn:
        if (text.charCodeAt(pos) === CharacterCodes.lineFeed) {
          pos++;
        }
      case CharacterCodes.lineFeed:
        result.push(lineStart);
        lineStart = pos;
        break;
      default:
        if (ch > CharacterCodes.maxAsciiCharacter && isLineBreak(ch)) {
          result.push(lineStart);
          lineStart = pos;
        }
        break;
    }
  }
  result.push(lineStart);
  return result;
}
function isWhiteSpaceLike(ch) {
  return isWhiteSpaceSingleLine(ch) || isLineBreak(ch);
}
function isWhiteSpaceSingleLine(ch) {
  return ch === CharacterCodes.space || ch === CharacterCodes.tab || ch === CharacterCodes.verticalTab || ch === CharacterCodes.formFeed || ch === CharacterCodes.nonBreakingSpace || ch === CharacterCodes.nextLine || ch === CharacterCodes.ogham || ch >= CharacterCodes.enQuad && ch <= CharacterCodes.zeroWidthSpace || ch === CharacterCodes.narrowNoBreakSpace || ch === CharacterCodes.mathematicalSpace || ch === CharacterCodes.ideographicSpace || ch === CharacterCodes.byteOrderMark;
}
function isLineBreak(ch) {
  return ch === CharacterCodes.lineFeed || ch === CharacterCodes.carriageReturn || ch === CharacterCodes.lineSeparator || ch === CharacterCodes.paragraphSeparator;
}
function skipTrivia(text, pos, stopAfterLineBreak, stopAtComments, inJSDoc) {
  if (pos < 0) {
    return pos;
  }
  let canConsumeStar = false;
  while (true) {
    const ch = text.charCodeAt(pos);
    switch (ch) {
      case CharacterCodes.carriageReturn:
        if (text.charCodeAt(pos + 1) === CharacterCodes.lineFeed) {
          pos++;
        }
      case CharacterCodes.lineFeed:
        pos++;
        if (stopAfterLineBreak) {
          return pos;
        }
        canConsumeStar = !!inJSDoc;
        continue;
      case CharacterCodes.tab:
      case CharacterCodes.verticalTab:
      case CharacterCodes.formFeed:
      case CharacterCodes.space:
        pos++;
        continue;
      case CharacterCodes.slash:
        if (stopAtComments) {
          break;
        }
        if (text.charCodeAt(pos + 1) === CharacterCodes.slash) {
          pos += 2;
          while (pos < text.length) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          canConsumeStar = false;
          continue;
        }
        if (text.charCodeAt(pos + 1) === CharacterCodes.asterisk) {
          pos += 2;
          while (pos < text.length) {
            if (text.charCodeAt(pos) === CharacterCodes.asterisk && text.charCodeAt(pos + 1) === CharacterCodes.slash) {
              pos += 2;
              break;
            }
            pos++;
          }
          canConsumeStar = false;
          continue;
        }
        break;
      case CharacterCodes.lessThan:
      case CharacterCodes.bar:
      case CharacterCodes.equals:
      case CharacterCodes.greaterThan:
        if (isConflictMarkerTrivia(text, pos)) {
          pos = scanConflictMarkerTrivia(text, pos);
          canConsumeStar = false;
          continue;
        }
        break;
      case CharacterCodes.hash:
        if (pos === 0 && isShebangTrivia(text, pos)) {
          pos = scanShebangTrivia(text, pos);
          continue;
        }
        break;
      case CharacterCodes.asterisk:
        if (canConsumeStar) {
          pos++;
          canConsumeStar = false;
          continue;
        }
        break;
      default:
        if (ch > CharacterCodes.maxAsciiCharacter && isWhiteSpaceLike(ch)) {
          pos++;
          continue;
        }
        break;
    }
    return pos;
  }
}
function isConflictMarkerTrivia(text, pos) {
  if (pos >= text.length) {
    return false;
  }
  const ch = text.charCodeAt(pos);
  if (pos === 0 || isLineBreak(text.charCodeAt(pos - 1))) {
    if (ch === CharacterCodes.lessThan || ch === CharacterCodes.greaterThan || ch === CharacterCodes.equals) {
      if (pos + 6 < text.length && text.charCodeAt(pos + 1) === ch && text.charCodeAt(pos + 2) === ch && text.charCodeAt(pos + 3) === ch && text.charCodeAt(pos + 4) === ch && text.charCodeAt(pos + 5) === ch && text.charCodeAt(pos + 6) === ch) {
        return ch === CharacterCodes.equals || text.charCodeAt(pos + 7) === CharacterCodes.space;
      }
    }
    if (ch === CharacterCodes.bar && pos + 6 < text.length && text.charCodeAt(pos + 1) === ch && text.charCodeAt(pos + 2) === ch && text.charCodeAt(pos + 3) === ch && text.charCodeAt(pos + 4) === ch && text.charCodeAt(pos + 5) === ch && text.charCodeAt(pos + 6) === ch) {
      return true;
    }
  }
  return false;
}
function scanConflictMarkerTrivia(text, pos) {
  const ch = text.charCodeAt(pos);
  const len = text.length;
  if (ch === CharacterCodes.lessThan || ch === CharacterCodes.greaterThan) {
    while (pos < len && !isLineBreak(text.charCodeAt(pos))) {
      pos++;
    }
  } else {
    pos += 7;
    while (pos < len) {
      const currentChar = text.charCodeAt(pos);
      if ((currentChar === CharacterCodes.equals || currentChar === CharacterCodes.greaterThan) && isConflictMarkerTrivia(text, pos)) {
        break;
      }
      pos++;
    }
  }
  return pos;
}
function isShebangTrivia(text, pos) {
  return pos === 0 && text.charCodeAt(0) === CharacterCodes.hash && text.charCodeAt(1) === CharacterCodes.exclamation;
}
function scanShebangTrivia(text, pos) {
  pos += 2;
  while (pos < text.length) {
    if (isLineBreak(text.charCodeAt(pos))) {
      break;
    }
    pos++;
  }
  return pos;
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/ast/astnav.js
function getTokenPosOfNode(node, sourceFile, includeJSDoc) {
  if (nodeIsMissing(node)) {
    return node.pos;
  }
  if (isJSDocNodeKind(node.kind) || node.kind === SyntaxKind.JsxText) {
    return skipTrivia(sourceFile.text, node.pos, false, true);
  }
  if (includeJSDoc && node.jsDoc && node.jsDoc.length > 0) {
    return getTokenPosOfNode(node.jsDoc[0], sourceFile, false);
  }
  return skipTrivia(sourceFile.text, node.pos, false, false, !!(node.flags & NodeFlags.JSDoc));
}
function nodeIsMissing(node) {
  return node.pos === node.end && node.pos >= 0 && node.kind !== SyntaxKind.EndOfFile;
}
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/protocol.generated.js
var childProperties = {
  [SyntaxKind.QualifiedName]: ["left", "right"],
  [SyntaxKind.ComputedPropertyName]: ["expression"],
  [SyntaxKind.Decorator]: ["expression"],
  [SyntaxKind.IfStatement]: ["expression", "thenStatement", "elseStatement"],
  [SyntaxKind.DoStatement]: ["statement", "expression"],
  [SyntaxKind.WhileStatement]: ["expression", "statement"],
  [SyntaxKind.ForStatement]: ["initializer", "condition", "incrementor", "statement"],
  [SyntaxKind.ForInStatement]: ["awaitModifier", "initializer", "expression", "statement"],
  [SyntaxKind.ForOfStatement]: ["awaitModifier", "initializer", "expression", "statement"],
  [SyntaxKind.BreakStatement]: ["label"],
  [SyntaxKind.ContinueStatement]: ["label"],
  [SyntaxKind.ReturnStatement]: ["expression"],
  [SyntaxKind.WithStatement]: ["expression", "statement"],
  [SyntaxKind.SwitchStatement]: ["expression", "caseBlock"],
  [SyntaxKind.CaseBlock]: ["clauses"],
  [SyntaxKind.CaseClause]: ["expression", "statements"],
  [SyntaxKind.DefaultClause]: ["expression", "statements"],
  [SyntaxKind.ThrowStatement]: ["expression"],
  [SyntaxKind.TryStatement]: ["tryBlock", "catchClause", "finallyBlock"],
  [SyntaxKind.CatchClause]: ["variableDeclaration", "block"],
  [SyntaxKind.LabeledStatement]: ["label", "statement"],
  [SyntaxKind.ExpressionStatement]: ["expression"],
  [SyntaxKind.Block]: ["statements"],
  [SyntaxKind.VariableStatement]: ["modifiers", "declarationList"],
  [SyntaxKind.VariableDeclaration]: ["name", "exclamationToken", "type", "initializer"],
  [SyntaxKind.VariableDeclarationList]: ["declarations"],
  [SyntaxKind.ObjectBindingPattern]: ["elements"],
  [SyntaxKind.ArrayBindingPattern]: ["elements"],
  [SyntaxKind.Parameter]: ["modifiers", "dotDotDotToken", "name", "questionToken", "type", "initializer"],
  [SyntaxKind.BindingElement]: ["dotDotDotToken", "propertyName", "name", "initializer"],
  [SyntaxKind.MissingDeclaration]: ["modifiers"],
  [SyntaxKind.FunctionDeclaration]: ["modifiers", "asteriskToken", "name", "typeParameters", "parameters", "type", "body"],
  [SyntaxKind.ClassDeclaration]: ["modifiers", "name", "typeParameters", "heritageClauses", "members"],
  [SyntaxKind.ClassExpression]: ["modifiers", "name", "typeParameters", "heritageClauses", "members"],
  [SyntaxKind.HeritageClause]: ["types"],
  [SyntaxKind.InterfaceDeclaration]: ["modifiers", "name", "typeParameters", "heritageClauses", "members"],
  [SyntaxKind.TypeAliasDeclaration]: ["modifiers", "name", "typeParameters", "type"],
  [SyntaxKind.JSTypeAliasDeclaration]: ["modifiers", "name", "typeParameters", "type"],
  [SyntaxKind.EnumMember]: ["name", "initializer"],
  [SyntaxKind.EnumDeclaration]: ["modifiers", "name", "members"],
  [SyntaxKind.ModuleBlock]: ["statements"],
  [SyntaxKind.ImportDeclaration]: ["modifiers", "importClause", "moduleSpecifier", "attributes"],
  [SyntaxKind.JSImportDeclaration]: ["modifiers", "importClause", "moduleSpecifier", "attributes"],
  [SyntaxKind.ExternalModuleReference]: ["expression"],
  [SyntaxKind.NamespaceImport]: ["name"],
  [SyntaxKind.NamedImports]: ["elements"],
  [SyntaxKind.ExportAssignment]: ["modifiers", "type", "expression"],
  [SyntaxKind.NamespaceExportDeclaration]: ["modifiers", "name"],
  [SyntaxKind.NamespaceExport]: ["name"],
  [SyntaxKind.NamedExports]: ["elements"],
  [SyntaxKind.ExportSpecifier]: ["propertyName", "name"],
  [SyntaxKind.CallSignature]: ["typeParameters", "parameters", "type"],
  [SyntaxKind.ConstructSignature]: ["typeParameters", "parameters", "type"],
  [SyntaxKind.Constructor]: ["modifiers", "typeParameters", "parameters", "type", "body"],
  [SyntaxKind.GetAccessor]: ["modifiers", "name", "typeParameters", "parameters", "type", "body"],
  [SyntaxKind.SetAccessor]: ["modifiers", "name", "typeParameters", "parameters", "type", "body"],
  [SyntaxKind.IndexSignature]: ["modifiers", "parameters", "type"],
  [SyntaxKind.MethodSignature]: ["modifiers", "name", "postfixToken", "typeParameters", "parameters", "type"],
  [SyntaxKind.MethodDeclaration]: ["modifiers", "asteriskToken", "name", "postfixToken", "typeParameters", "parameters", "type", "body"],
  [SyntaxKind.PropertySignature]: ["modifiers", "name", "postfixToken", "type", "initializer"],
  [SyntaxKind.PropertyDeclaration]: ["modifiers", "name", "postfixToken", "type", "initializer"],
  [SyntaxKind.ClassStaticBlockDeclaration]: ["modifiers", "body"],
  [SyntaxKind.BinaryExpression]: ["modifiers", "left", "type", "operatorToken", "right"],
  [SyntaxKind.PrefixUnaryExpression]: ["operand"],
  [SyntaxKind.PostfixUnaryExpression]: ["operand"],
  [SyntaxKind.YieldExpression]: ["asteriskToken", "expression"],
  [SyntaxKind.ArrowFunction]: ["modifiers", "typeParameters", "parameters", "type", "equalsGreaterThanToken", "body"],
  [SyntaxKind.FunctionExpression]: ["modifiers", "asteriskToken", "name", "typeParameters", "parameters", "type", "body"],
  [SyntaxKind.AsExpression]: ["expression", "type"],
  [SyntaxKind.SatisfiesExpression]: ["expression", "type"],
  [SyntaxKind.ConditionalExpression]: ["condition", "questionToken", "whenTrue", "colonToken", "whenFalse"],
  [SyntaxKind.PropertyAccessExpression]: ["expression", "questionDotToken", "name"],
  [SyntaxKind.ElementAccessExpression]: ["expression", "questionDotToken", "argumentExpression"],
  [SyntaxKind.CallExpression]: ["expression", "questionDotToken", "typeArguments", "arguments"],
  [SyntaxKind.NewExpression]: ["expression", "typeArguments", "arguments"],
  [SyntaxKind.MetaProperty]: ["name"],
  [SyntaxKind.NonNullExpression]: ["expression"],
  [SyntaxKind.SpreadElement]: ["expression"],
  [SyntaxKind.TemplateExpression]: ["head", "templateSpans"],
  [SyntaxKind.TemplateSpan]: ["expression", "literal"],
  [SyntaxKind.TaggedTemplateExpression]: ["tag", "questionDotToken", "typeArguments", "template"],
  [SyntaxKind.ParenthesizedExpression]: ["expression"],
  [SyntaxKind.ArrayLiteralExpression]: ["elements"],
  [SyntaxKind.ObjectLiteralExpression]: ["properties"],
  [SyntaxKind.SpreadAssignment]: ["expression"],
  [SyntaxKind.PropertyAssignment]: ["modifiers", "name", "postfixToken", "type", "initializer"],
  [SyntaxKind.ShorthandPropertyAssignment]: ["modifiers", "name", "postfixToken", "type", "equalsToken", "objectAssignmentInitializer"],
  [SyntaxKind.DeleteExpression]: ["expression"],
  [SyntaxKind.TypeOfExpression]: ["expression"],
  [SyntaxKind.VoidExpression]: ["expression"],
  [SyntaxKind.AwaitExpression]: ["expression"],
  [SyntaxKind.TypeAssertionExpression]: ["type", "expression"],
  [SyntaxKind.UnionType]: ["types"],
  [SyntaxKind.IntersectionType]: ["types"],
  [SyntaxKind.ConditionalType]: ["checkType", "extendsType", "trueType", "falseType"],
  [SyntaxKind.TypeOperator]: ["type"],
  [SyntaxKind.InferType]: ["typeParameter"],
  [SyntaxKind.ArrayType]: ["elementType"],
  [SyntaxKind.IndexedAccessType]: ["objectType", "indexType"],
  [SyntaxKind.TypeReference]: ["typeName", "typeArguments"],
  [SyntaxKind.ExpressionWithTypeArguments]: ["expression", "typeArguments"],
  [SyntaxKind.LiteralType]: ["literal"],
  [SyntaxKind.TypePredicate]: ["assertsModifier", "parameterName", "type"],
  [SyntaxKind.ImportAttribute]: ["name", "value"],
  [SyntaxKind.ImportAttributes]: ["attributes"],
  [SyntaxKind.TypeQuery]: ["exprName", "typeArguments"],
  [SyntaxKind.MappedType]: ["readonlyToken", "typeParameter", "nameType", "questionToken", "type", "members"],
  [SyntaxKind.TypeLiteral]: ["members"],
  [SyntaxKind.TupleType]: ["elements"],
  [SyntaxKind.NamedTupleMember]: ["dotDotDotToken", "name", "questionToken", "type"],
  [SyntaxKind.OptionalType]: ["type"],
  [SyntaxKind.RestType]: ["type"],
  [SyntaxKind.ParenthesizedType]: ["type"],
  [SyntaxKind.FunctionType]: ["typeParameters", "parameters", "type"],
  [SyntaxKind.ConstructorType]: ["modifiers", "typeParameters", "parameters", "type"],
  [SyntaxKind.TemplateLiteralType]: ["head", "templateSpans"],
  [SyntaxKind.TemplateLiteralTypeSpan]: ["type", "literal"],
  [SyntaxKind.SyntheticExpression]: ["tupleNameSource"],
  [SyntaxKind.PartiallyEmittedExpression]: ["expression"],
  [SyntaxKind.JsxElement]: ["openingElement", "children", "closingElement"],
  [SyntaxKind.JsxAttributes]: ["properties"],
  [SyntaxKind.JsxNamespacedName]: ["namespace", "name"],
  [SyntaxKind.JsxOpeningElement]: ["tagName", "typeArguments", "attributes"],
  [SyntaxKind.JsxSelfClosingElement]: ["tagName", "typeArguments", "attributes"],
  [SyntaxKind.JsxFragment]: ["openingFragment", "children", "closingFragment"],
  [SyntaxKind.JsxAttribute]: ["name", "initializer"],
  [SyntaxKind.JsxSpreadAttribute]: ["expression"],
  [SyntaxKind.JsxClosingElement]: ["tagName"],
  [SyntaxKind.JsxExpression]: ["dotDotDotToken", "expression"],
  [SyntaxKind.SyntaxList]: ["children"],
  [SyntaxKind.JSDoc]: ["comment", "tags"],
  [SyntaxKind.JSDocTypeExpression]: ["type"],
  [SyntaxKind.JSDocNonNullableType]: ["type"],
  [SyntaxKind.JSDocNullableType]: ["type"],
  [SyntaxKind.JSDocVariadicType]: ["type"],
  [SyntaxKind.JSDocOptionalType]: ["type"],
  [SyntaxKind.JSDocTypeTag]: ["tagName", "typeExpression", "comment"],
  [SyntaxKind.JSDocUnknownTag]: ["tagName", "comment"],
  [SyntaxKind.JSDocTemplateTag]: ["tagName", "constraint", "typeParameters", "comment"],
  [SyntaxKind.JSDocReturnTag]: ["tagName", "typeExpression", "comment"],
  [SyntaxKind.JSDocPublicTag]: ["tagName", "comment"],
  [SyntaxKind.JSDocPrivateTag]: ["tagName", "comment"],
  [SyntaxKind.JSDocProtectedTag]: ["tagName", "comment"],
  [SyntaxKind.JSDocReadonlyTag]: ["tagName", "comment"],
  [SyntaxKind.JSDocOverrideTag]: ["tagName", "comment"],
  [SyntaxKind.JSDocDeprecatedTag]: ["tagName", "comment"],
  [SyntaxKind.JSDocSeeTag]: ["tagName", "nameExpression", "comment"],
  [SyntaxKind.JSDocImplementsTag]: ["tagName", "className", "comment"],
  [SyntaxKind.JSDocAugmentsTag]: ["tagName", "className", "comment"],
  [SyntaxKind.JSDocSatisfiesTag]: ["tagName", "typeExpression", "comment"],
  [SyntaxKind.JSDocThrowsTag]: ["tagName", "typeExpression", "comment"],
  [SyntaxKind.JSDocThisTag]: ["tagName", "typeExpression", "comment"],
  [SyntaxKind.JSDocImportTag]: ["tagName", "importClause", "moduleSpecifier", "attributes", "comment"],
  [SyntaxKind.JSDocCallbackTag]: ["tagName", "typeExpression", "name", "comment"],
  [SyntaxKind.JSDocOverloadTag]: ["tagName", "typeExpression", "comment"],
  [SyntaxKind.JSDocTypedefTag]: ["tagName", "typeExpression", "name", "comment"],
  [SyntaxKind.JSDocSignature]: ["typeParameters", "parameters", "type"],
  [SyntaxKind.JSDocNameReference]: ["name"],
  [SyntaxKind.SourceFile]: ["statements", "endOfFileToken"],
  [SyntaxKind.ModuleDeclaration]: ["modifiers", "name", "body"],
  [SyntaxKind.ImportEqualsDeclaration]: ["modifiers", "name", "moduleReference"],
  [SyntaxKind.ExportDeclaration]: ["modifiers", "exportClause", "moduleSpecifier", "attributes"],
  [SyntaxKind.ImportType]: ["argument", "attributes", "qualifier", "typeArguments"],
  [SyntaxKind.ImportClause]: ["name", "namedBindings"],
  [SyntaxKind.ImportSpecifier]: ["propertyName", "name"],
  [SyntaxKind.JSDocLink]: ["name"],
  [SyntaxKind.JSDocLinkPlain]: ["name"],
  [SyntaxKind.JSDocLinkCode]: ["name"],
  [SyntaxKind.TypeParameter]: ["modifiers", "name", "constraint", "expression", "defaultType"],
  [SyntaxKind.SyntheticReferenceExpression]: ["expression", "thisArg"],
  [SyntaxKind.JSDocTypeLiteral]: ["jsdocPropertyTags"],
  [SyntaxKind.JSDocParameterTag]: ["tagName", "name", "typeExpression", "comment"],
  [SyntaxKind.JSDocPropertyTag]: ["tagName", "name", "typeExpression", "comment"]
};
var singleChildNodePropertyNames = {
  [SyntaxKind.ComputedPropertyName]: "expression",
  [SyntaxKind.Decorator]: "expression",
  [SyntaxKind.BreakStatement]: "label",
  [SyntaxKind.ContinueStatement]: "label",
  [SyntaxKind.ReturnStatement]: "expression",
  [SyntaxKind.CaseBlock]: "clauses",
  [SyntaxKind.ThrowStatement]: "expression",
  [SyntaxKind.ExpressionStatement]: "expression",
  [SyntaxKind.Block]: "statements",
  [SyntaxKind.VariableDeclarationList]: "declarations",
  [SyntaxKind.ObjectBindingPattern]: "elements",
  [SyntaxKind.ArrayBindingPattern]: "elements",
  [SyntaxKind.MissingDeclaration]: "modifiers",
  [SyntaxKind.HeritageClause]: "types",
  [SyntaxKind.ModuleBlock]: "statements",
  [SyntaxKind.ExternalModuleReference]: "expression",
  [SyntaxKind.NamespaceImport]: "name",
  [SyntaxKind.NamedImports]: "elements",
  [SyntaxKind.NamespaceExport]: "name",
  [SyntaxKind.NamedExports]: "elements",
  [SyntaxKind.PrefixUnaryExpression]: "operand",
  [SyntaxKind.PostfixUnaryExpression]: "operand",
  [SyntaxKind.MetaProperty]: "name",
  [SyntaxKind.NonNullExpression]: "expression",
  [SyntaxKind.SpreadElement]: "expression",
  [SyntaxKind.ParenthesizedExpression]: "expression",
  [SyntaxKind.ArrayLiteralExpression]: "elements",
  [SyntaxKind.ObjectLiteralExpression]: "properties",
  [SyntaxKind.SpreadAssignment]: "expression",
  [SyntaxKind.DeleteExpression]: "expression",
  [SyntaxKind.TypeOfExpression]: "expression",
  [SyntaxKind.VoidExpression]: "expression",
  [SyntaxKind.AwaitExpression]: "expression",
  [SyntaxKind.UnionType]: "types",
  [SyntaxKind.IntersectionType]: "types",
  [SyntaxKind.TypeOperator]: "type",
  [SyntaxKind.InferType]: "typeParameter",
  [SyntaxKind.ArrayType]: "elementType",
  [SyntaxKind.LiteralType]: "literal",
  [SyntaxKind.ImportAttributes]: "attributes",
  [SyntaxKind.TypeLiteral]: "members",
  [SyntaxKind.TupleType]: "elements",
  [SyntaxKind.OptionalType]: "type",
  [SyntaxKind.RestType]: "type",
  [SyntaxKind.ParenthesizedType]: "type",
  [SyntaxKind.SyntheticExpression]: "tupleNameSource",
  [SyntaxKind.PartiallyEmittedExpression]: "expression",
  [SyntaxKind.JsxAttributes]: "properties",
  [SyntaxKind.JsxSpreadAttribute]: "expression",
  [SyntaxKind.JsxClosingElement]: "tagName",
  [SyntaxKind.SyntaxList]: "children",
  [SyntaxKind.JSDocTypeExpression]: "type",
  [SyntaxKind.JSDocNonNullableType]: "type",
  [SyntaxKind.JSDocNullableType]: "type",
  [SyntaxKind.JSDocVariadicType]: "type",
  [SyntaxKind.JSDocOptionalType]: "type",
  [SyntaxKind.JSDocNameReference]: "name",
  [SyntaxKind.JSDocLink]: "name",
  [SyntaxKind.JSDocLinkPlain]: "name",
  [SyntaxKind.JSDocLinkCode]: "name",
  [SyntaxKind.JSDocTypeLiteral]: "jsdocPropertyTags"
};

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/protocol.js
var PROTOCOL_VERSION = 5;
var HEADER_OFFSET_METADATA = 0;
var HEADER_OFFSET_HASH_LO0 = 4;
var HEADER_OFFSET_HASH_LO1 = 8;
var HEADER_OFFSET_HASH_HI0 = 12;
var HEADER_OFFSET_HASH_HI1 = 16;
var HEADER_OFFSET_PARSE_OPTIONS = 20;
var HEADER_OFFSET_STRING_TABLE_OFFSETS = 24;
var HEADER_OFFSET_STRING_TABLE = 28;
var HEADER_OFFSET_EXTENDED_DATA = 32;
var HEADER_OFFSET_STRUCTURED_DATA = 36;
var HEADER_OFFSET_NODES = 40;
var HEADER_SIZE = 44;
var NODE_LEN = 28;
var NODE_OFFSET_KIND = 0;
var NODE_OFFSET_POS = 4;
var NODE_OFFSET_END = 8;
var NODE_OFFSET_NEXT = 12;
var NODE_OFFSET_PARENT = 16;
var NODE_OFFSET_DATA = 20;
var NODE_OFFSET_FLAGS = 24;
var KIND_NODE_LIST = 4294967295;
var NODE_DATA_TYPE_CHILDREN = 0;
var NODE_DATA_TYPE_STRING = 1073741824;
var NODE_DATA_TYPE_EXTENDED = 2147483648;

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/encoder.generated.js
function getNodeDataType(kind) {
  switch (kind) {
    case SyntaxKind.Identifier:
    case SyntaxKind.PrivateIdentifier:
    case SyntaxKind.JsxText:
    case SyntaxKind.JSDocText:
    case SyntaxKind.JSDocLink:
    case SyntaxKind.JSDocLinkPlain:
    case SyntaxKind.JSDocLinkCode:
      return NODE_DATA_TYPE_STRING;
    case SyntaxKind.StringLiteral:
    case SyntaxKind.NumericLiteral:
    case SyntaxKind.BigIntLiteral:
    case SyntaxKind.RegularExpressionLiteral:
    case SyntaxKind.NoSubstitutionTemplateLiteral:
    case SyntaxKind.TemplateHead:
    case SyntaxKind.TemplateMiddle:
    case SyntaxKind.TemplateTail:
    case SyntaxKind.SourceFile:
      return NODE_DATA_TYPE_EXTENDED;
    default:
      return NODE_DATA_TYPE_CHILDREN;
  }
}
function getNodeCommonData(node) {
  switch (node.kind) {
    case SyntaxKind.Block:
      return (node.multiLine ? 1 : 0) << 24;
    case SyntaxKind.HeritageClause:
      return (node.token === SyntaxKind.ImplementsKeyword ? 1 : 0) << 24;
    case SyntaxKind.ExportAssignment:
      return (node.isExportEquals ? 1 : 0) << 24;
    case SyntaxKind.ExportSpecifier:
      return (node.isTypeOnly ? 1 : 0) << 24;
    case SyntaxKind.PrefixUnaryExpression:
      return (node.operator === SyntaxKind.MinusToken ? 1 : node.operator === SyntaxKind.TildeToken ? 2 : node.operator === SyntaxKind.ExclamationToken ? 3 : node.operator === SyntaxKind.PlusPlusToken ? 4 : node.operator === SyntaxKind.MinusMinusToken ? 5 : 0) << 24;
    case SyntaxKind.PostfixUnaryExpression:
      return (node.operator === SyntaxKind.MinusMinusToken ? 1 : 0) << 24;
    case SyntaxKind.MetaProperty:
      return (node.keywordToken === SyntaxKind.NewKeyword ? 1 : 0) << 24;
    case SyntaxKind.ArrayLiteralExpression:
      return (node.multiLine ? 1 : 0) << 24;
    case SyntaxKind.ObjectLiteralExpression:
      return (node.multiLine ? 1 : 0) << 24;
    case SyntaxKind.TypeOperator:
      return (node.operator === SyntaxKind.ReadonlyKeyword ? 1 : node.operator === SyntaxKind.UniqueKeyword ? 2 : 0) << 24;
    case SyntaxKind.ImportAttributes:
      return (node.multiLine ? 1 : 0) << 24 | (node.token === SyntaxKind.AssertKeyword ? 1 : 0) << 25;
    case SyntaxKind.JsxText:
      return (node.containsOnlyTriviaWhiteSpaces ? 1 : 0) << 24;
    case SyntaxKind.ModuleDeclaration:
      return (node.keyword === SyntaxKind.NamespaceKeyword ? 1 : 0) << 24;
    case SyntaxKind.ImportEqualsDeclaration:
      return (node.isTypeOnly ? 1 : 0) << 24;
    case SyntaxKind.ExportDeclaration:
      return (node.isTypeOnly ? 1 : 0) << 24;
    case SyntaxKind.ImportType:
      return (node.isTypeOf ? 1 : 0) << 24;
    case SyntaxKind.ImportClause:
      return (node.phaseModifier === SyntaxKind.TypeKeyword ? 1 : node.phaseModifier === SyntaxKind.DeferKeyword ? 2 : 0) << 24;
    case SyntaxKind.ImportSpecifier:
      return (node.isTypeOnly ? 1 : 0) << 24;
    case SyntaxKind.JSDocTypeLiteral:
      return (node.isArrayType ? 1 : 0) << 24;
    case SyntaxKind.JSDocParameterTag:
    case SyntaxKind.JSDocPropertyTag:
      return (node.isBracketed ? 1 : 0) << 24 | (node.isNameFirst ? 1 : 0) << 25;
  }
  return 0;
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/wtf8.js
import { Buffer as Buffer2 } from "node:buffer";
var surrogateLeadByte = 237;
var surrogateSecondByteMin = 160;
var surrogateSecondByteMax = 191;
var continuationByteMin = 128;
var continuationByteMax = 191;
function isWtf8Surrogate(bytes, index) {
  return index + 2 < bytes.length && bytes[index] === surrogateLeadByte && bytes[index + 1] >= surrogateSecondByteMin && bytes[index + 1] <= surrogateSecondByteMax && bytes[index + 2] >= continuationByteMin && bytes[index + 2] <= continuationByteMax;
}
function getSurrogateCodeUnit(bytes, index) {
  return 53248 | (bytes[index + 1] & 63) << 6 | bytes[index + 2] & 63;
}
function hasSurrogateLeadByte(bytes) {
  return Buffer2.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(surrogateLeadByte) >= 0;
}
function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

class Wtf8Decoder extends TextDecoder {
  decode(input, options) {
    if (input === undefined) {
      return super.decode(input, options);
    }
    const bytes = toUint8Array(input);
    if (!hasSurrogateLeadByte(bytes)) {
      return super.decode(bytes, options);
    }
    const parts = [];
    let segmentStart = 0;
    for (let i = 0;i < bytes.length; i++) {
      if (!isWtf8Surrogate(bytes, i)) {
        continue;
      }
      if (segmentStart < i) {
        parts.push(super.decode(bytes.subarray(segmentStart, i), options));
      }
      parts.push(String.fromCharCode(getSurrogateCodeUnit(bytes, i)));
      i += 2;
      segmentStart = i + 1;
    }
    if (segmentStart === 0) {
      return super.decode(bytes, options);
    }
    if (segmentStart < bytes.length) {
      parts.push(super.decode(bytes.subarray(segmentStart), options));
    }
    return parts.join("");
  }
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/msgpack.js
var MSGPACK_FIXARRAY3 = 147;
var MSGPACK_BIN8 = 196;
var MSGPACK_BIN16 = 197;
var MSGPACK_BIN32 = 198;
var MSGPACK_UINT8 = 204;
function binHeaderSize(len) {
  if (len < 256)
    return 2;
  if (len < 65536)
    return 3;
  return 5;
}
function writeBinHeader(buf, off, len) {
  if (len < 256) {
    buf[off++] = MSGPACK_BIN8;
    buf[off++] = len;
  } else if (len < 65536) {
    buf[off++] = MSGPACK_BIN16;
    buf[off++] = len >>> 8 & 255;
    buf[off++] = len & 255;
  } else {
    buf[off++] = MSGPACK_BIN32;
    buf[off++] = len >>> 24 & 255;
    buf[off++] = len >>> 16 & 255;
    buf[off++] = len >>> 8 & 255;
    buf[off++] = len & 255;
  }
  return off;
}
var encoder = new TextEncoder;
var decoder = new Wtf8Decoder;

class MsgpackWriter {
  buf;
  view;
  pos;
  constructor(initialSize = 256) {
    this.buf = new Uint8Array(initialSize);
    this.view = new DataView(this.buf.buffer);
    this.pos = 0;
  }
  ensure(n) {
    if (this.pos + n > this.buf.length) {
      let newSize = this.buf.length * 2;
      while (newSize < this.pos + n)
        newSize *= 2;
      const next = new Uint8Array(newSize);
      next.set(this.buf);
      this.buf = next;
      this.view = new DataView(this.buf.buffer);
    }
  }
  writeArrayHeader(length) {
    if (length <= 15) {
      this.ensure(1);
      this.buf[this.pos++] = 144 | length;
    } else if (length <= 65535) {
      this.ensure(3);
      this.buf[this.pos++] = 220;
      this.view.setUint16(this.pos, length, false);
      this.pos += 2;
    } else {
      this.ensure(5);
      this.buf[this.pos++] = 221;
      this.view.setUint32(this.pos, length, false);
      this.pos += 4;
    }
  }
  writeUint(value) {
    if (value <= 127) {
      this.ensure(1);
      this.buf[this.pos++] = value;
    } else if (value <= 255) {
      this.ensure(2);
      this.buf[this.pos++] = 204;
      this.buf[this.pos++] = value;
    } else if (value <= 65535) {
      this.ensure(3);
      this.buf[this.pos++] = 205;
      this.view.setUint16(this.pos, value, false);
      this.pos += 2;
    } else {
      this.ensure(5);
      this.buf[this.pos++] = 206;
      this.view.setUint32(this.pos, value, false);
      this.pos += 4;
    }
  }
  writeString(str) {
    const encoded = encoder.encode(str);
    const len = encoded.length;
    if (len <= 31) {
      this.ensure(1 + len);
      this.buf[this.pos++] = 160 | len;
    } else if (len <= 255) {
      this.ensure(2 + len);
      this.buf[this.pos++] = 217;
      this.buf[this.pos++] = len;
    } else if (len <= 65535) {
      this.ensure(3 + len);
      this.buf[this.pos++] = 218;
      this.view.setUint16(this.pos, len, false);
      this.pos += 2;
    } else {
      this.ensure(5 + len);
      this.buf[this.pos++] = 219;
      this.view.setUint32(this.pos, len, false);
      this.pos += 4;
    }
    this.buf.set(encoded, this.pos);
    this.pos += len;
  }
  writeBool(value) {
    this.ensure(1);
    this.buf[this.pos++] = value ? 195 : 194;
  }
  finish() {
    return this.buf.subarray(0, this.pos);
  }
}

class MsgpackReader {
  buf;
  view;
  pos;
  constructor(data, offset = 0) {
    this.buf = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = offset;
  }
  readArrayHeader() {
    const byte = this.buf[this.pos++];
    if ((byte & 240) === 144)
      return byte & 15;
    if (byte === 220) {
      const len = this.view.getUint16(this.pos, false);
      this.pos += 2;
      return len;
    }
    if (byte === 221) {
      const len = this.view.getUint32(this.pos, false);
      this.pos += 4;
      return len;
    }
    throw new Error(`Expected array header, got 0x${byte.toString(16)}`);
  }
  readUint() {
    const byte = this.buf[this.pos++];
    if (byte <= 127)
      return byte;
    if (byte === 204)
      return this.buf[this.pos++];
    if (byte === 205) {
      const val = this.view.getUint16(this.pos, false);
      this.pos += 2;
      return val;
    }
    if (byte === 206) {
      const val = this.view.getUint32(this.pos, false);
      this.pos += 4;
      return val;
    }
    throw new Error(`Expected uint, got 0x${byte.toString(16)}`);
  }
  readString() {
    const byte = this.buf[this.pos++];
    let len;
    if ((byte & 224) === 160) {
      len = byte & 31;
    } else if (byte === 217) {
      len = this.buf[this.pos++];
    } else if (byte === 218) {
      len = this.view.getUint16(this.pos, false);
      this.pos += 2;
    } else if (byte === 219) {
      len = this.view.getUint32(this.pos, false);
      this.pos += 4;
    } else {
      throw new Error(`Expected string, got 0x${byte.toString(16)}`);
    }
    const str = decoder.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return str;
  }
  readBool() {
    const byte = this.buf[this.pos++];
    if (byte === 195)
      return true;
    if (byte === 194)
      return false;
    throw new Error(`Expected bool, got 0x${byte.toString(16)}`);
  }
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/encoder.js
var NODE_FIELDS = NODE_LEN / 4;
var NODE_FIELD_NEXT = 3;
var NO_STRUCTURED_DATA = 4294967295;

class StringTable {
  parts;
  byteLen;
  offsets;
  constructor() {
    this.parts = [];
    this.byteLen = 0;
    this.offsets = [];
  }
  add(text) {
    const index = this.offsets.length;
    const encoder = cachedEncoder();
    const encodedLength = encoder.encode(text).length;
    const offset = this.byteLen;
    this.parts.push(text);
    this.byteLen += encodedLength;
    this.offsets.push(offset, offset + encodedLength);
    return index;
  }
  encode() {
    const encoder = cachedEncoder();
    const dataBytes = encoder.encode(this.parts.join(""));
    const offsetBytes = new Uint8Array(this.offsets.length * 4);
    const view = new DataView(offsetBytes.buffer);
    for (let i = 0;i < this.offsets.length; i++) {
      view.setUint32(i * 4, this.offsets[i], true);
    }
    const result = new Uint8Array(offsetBytes.length + dataBytes.length);
    result.set(offsetBytes, 0);
    result.set(dataBytes, offsetBytes.length);
    return result;
  }
  stringByteLength() {
    return this.byteLen;
  }
  offsetsCount() {
    return this.offsets.length;
  }
}
var _encoder;
function cachedEncoder() {
  return _encoder ??= new TextEncoder;
}
function getChildrenPropertyMask(node) {
  const kind = node.kind;
  const props = childProperties[kind];
  if (!props) {
    return 0;
  }
  const n = node;
  let mask = 0;
  for (let i = 0;i < props.length; i++) {
    const prop = props[i];
    if (prop !== undefined && isChildPresent(n[prop])) {
      mask |= 1 << i;
    }
  }
  return mask;
}
function isChildPresent(v) {
  if (v === undefined || v === null)
    return false;
  return true;
}
function recordNodeStrings(node, strs) {
  return strs.add(node.text ?? "");
}
function encodeFileReferences(refs, writer) {
  if (!refs || refs.length === 0)
    return NO_STRUCTURED_DATA;
  const offset = writer.finish().length;
  writer.writeArrayHeader(refs.length);
  for (const ref of refs) {
    writer.writeArrayHeader(5);
    writer.writeUint(ref.pos);
    writer.writeUint(ref.end);
    writer.writeString(ref.fileName);
    writer.writeUint(ref.resolutionMode ?? 0);
    writer.writeBool(ref.preserve ?? false);
  }
  return offset;
}
function recordExtendedData(node, strs, extendedData, structuredWriter) {
  const offset = extendedData.length * 4;
  if (node.kind === SyntaxKind.SourceFile) {
    const sf = node;
    const textIndex = strs.add(sf.text);
    const fileNameIndex = strs.add(sf.fileName);
    const pathIndex = strs.add(sf.path);
    const referencedFilesOffset = encodeFileReferences(sf.referencedFiles, structuredWriter);
    const typeRefDirectivesOffset = encodeFileReferences(sf.typeReferenceDirectives, structuredWriter);
    const libRefDirectivesOffset = encodeFileReferences(sf.libReferenceDirectives, structuredWriter);
    extendedData.push(textIndex, fileNameIndex, pathIndex, sf.languageVariant, sf.scriptKind, referencedFilesOffset, typeRefDirectivesOffset, libRefDirectivesOffset, NO_STRUCTURED_DATA, NO_STRUCTURED_DATA, NO_STRUCTURED_DATA, 0);
  } else if (node.kind === SyntaxKind.TemplateHead || node.kind === SyntaxKind.TemplateMiddle || node.kind === SyntaxKind.TemplateTail) {
    const tmpl = node;
    const text = tmpl.text ?? "";
    const rawText = tmpl.rawText ?? "";
    const templateFlags = tmpl.templateFlags ?? 0;
    const textIndex = strs.add(text);
    const rawTextIndex = strs.add(rawText);
    extendedData.push(textIndex, rawTextIndex, templateFlags);
  } else {
    const n = node;
    const text = n.text ?? "";
    const tokenFlags = n.tokenFlags ?? 0;
    const textIndex = strs.add(text);
    extendedData.push(textIndex, tokenFlags);
  }
  return offset;
}
function getNodeData(node, strs, extendedData, structuredWriter) {
  const t = getNodeDataType(node.kind);
  const common = getNodeCommonData(node);
  switch (t) {
    case NODE_DATA_TYPE_CHILDREN:
      return t | common | getChildrenPropertyMask(node);
    case NODE_DATA_TYPE_STRING:
      return t | common | recordNodeStrings(node, strs);
    case NODE_DATA_TYPE_EXTENDED:
      return t | common | recordExtendedData(node, strs, extendedData, structuredWriter);
    default:
      throw new Error("unreachable");
  }
}
function getChildPropertiesForNode(node) {
  return childProperties[node.kind];
}
function isNodeArray2(value) {
  return Array.isArray(value) && typeof value.pos === "number" && typeof value.end === "number";
}
function encodeNode(node) {
  const strs = new StringTable;
  const extendedDataValues = [];
  const structuredWriter = new MsgpackWriter;
  const nodeValues = [];
  nodeValues.push(0, 0, 0, 0, 0, 0, 0);
  let nodeCount = 0;
  let parentIndex = 0;
  let prevIndex = 0;
  function visitNode(node) {
    nodeCount++;
    const currentIndex = nodeCount;
    if (prevIndex !== 0) {
      nodeValues[prevIndex * NODE_FIELDS + NODE_FIELD_NEXT] = currentIndex;
    }
    const data = getNodeData(node, strs, extendedDataValues, structuredWriter);
    nodeValues.push(node.kind, node.pos >= 0 ? node.pos : 0, node.end >= 0 ? node.end : 0, 0, parentIndex, data, node.flags);
    const saveParentIndex = parentIndex;
    const savePrevIndex = prevIndex;
    parentIndex = currentIndex;
    prevIndex = 0;
    visitChildren(node);
    prevIndex = currentIndex;
    parentIndex = saveParentIndex;
  }
  function visitNodeList(list) {
    if (!list) {
      return;
    }
    nodeCount++;
    const currentIndex = nodeCount;
    if (prevIndex !== 0) {
      nodeValues[prevIndex * NODE_FIELDS + NODE_FIELD_NEXT] = currentIndex;
    }
    nodeValues.push(KIND_NODE_LIST, list.pos >= 0 ? list.pos : 0, list.end >= 0 ? list.end : 0, 0, parentIndex, list.length, 0);
    const saveParentIndex = parentIndex;
    parentIndex = currentIndex;
    prevIndex = 0;
    for (const child of list) {
      visitNode(child);
    }
    prevIndex = currentIndex;
    parentIndex = saveParentIndex;
  }
  function visitChildren(node) {
    const props = getChildPropertiesForNode(node);
    const n = node;
    if (props) {
      for (const propName of props) {
        if (propName === undefined)
          continue;
        const child = n[propName];
        if (child === undefined || child === null)
          continue;
        if (isNodeArray2(child)) {
          visitNodeList(child);
        } else {
          visitNode(child);
        }
      }
    }
  }
  nodeCount++;
  parentIndex++;
  const rootData = getNodeData(node, strs, extendedDataValues, structuredWriter);
  nodeValues.push(node.kind, node.pos >= 0 ? node.pos : 0, node.end >= 0 ? node.end : 0, 0, 0, rootData, node.flags);
  const saveParent = parentIndex;
  prevIndex = 0;
  parentIndex = 1;
  visitChildren(node);
  parentIndex = saveParent;
  const extendedDataBytes = new Uint8Array(extendedDataValues.length * 4);
  const extView = new DataView(extendedDataBytes.buffer);
  for (let i = 0;i < extendedDataValues.length; i++) {
    extView.setUint32(i * 4, extendedDataValues[i], true);
  }
  const structuredDataBytes = structuredWriter.finish();
  const strsBytes = strs.encode();
  const nodesBytes = new Uint8Array(nodeValues.length * 4);
  const nodesView = new DataView(nodesBytes.buffer);
  for (let i = 0;i < nodeValues.length; i++) {
    nodesView.setUint32(i * 4, nodeValues[i] >>> 0, true);
  }
  const offsetStringTableOffsets = HEADER_SIZE;
  const offsetStringTableData = HEADER_SIZE + strs.offsetsCount() * 4;
  const offsetExtendedData = offsetStringTableData + strs.stringByteLength();
  const offsetStructuredData = offsetExtendedData + extendedDataBytes.length;
  const offsetNodes = offsetStructuredData + structuredDataBytes.length;
  const header = new Uint8Array(HEADER_SIZE);
  const headerView = new DataView(header.buffer);
  const metadata = PROTOCOL_VERSION << 24;
  headerView.setUint32(HEADER_OFFSET_METADATA, metadata, true);
  headerView.setUint32(HEADER_OFFSET_STRING_TABLE_OFFSETS, offsetStringTableOffsets, true);
  headerView.setUint32(HEADER_OFFSET_STRING_TABLE, offsetStringTableData, true);
  headerView.setUint32(HEADER_OFFSET_EXTENDED_DATA, offsetExtendedData, true);
  headerView.setUint32(HEADER_OFFSET_STRUCTURED_DATA, offsetStructuredData, true);
  headerView.setUint32(HEADER_OFFSET_NODES, offsetNodes, true);
  const result = new Uint8Array(header.length + strsBytes.length + extendedDataBytes.length + structuredDataBytes.length + nodesBytes.length);
  result.set(header, 0);
  result.set(strsBytes, HEADER_SIZE);
  result.set(extendedDataBytes, offsetExtendedData);
  result.set(structuredDataBytes, offsetStructuredData);
  result.set(nodesBytes, offsetNodes);
  return result;
}
function uint8ArrayToBase64(data) {
  return Buffer.from(data).toString("base64");
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/node.infrastructure.js
var popcount8 = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4, 1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7, 1, 2, 2, 3, 2, 3, 3, 4, 2, 3, 3, 4, 3, 4, 4, 5, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7, 2, 3, 3, 4, 3, 4, 4, 5, 3, 4, 4, 5, 4, 5, 5, 6, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7, 3, 4, 4, 5, 4, 5, 5, 6, 4, 5, 5, 6, 5, 6, 6, 7, 4, 5, 5, 6, 5, 6, 6, 7, 5, 6, 6, 7, 6, 7, 7, 8];
var NODE_DATA_TYPE_MASK = 3221225472;
var NODE_CHILD_MASK = 255;
var NODE_STRING_INDEX_MASK = 16777215;
var NODE_EXTENDED_DATA_MASK = 16777215;
function readSourceFileHash(data) {
  const lo0 = data.getUint32(HEADER_OFFSET_HASH_LO0, true);
  const lo1 = data.getUint32(HEADER_OFFSET_HASH_LO1, true);
  const hi0 = data.getUint32(HEADER_OFFSET_HASH_HI0, true);
  const hi1 = data.getUint32(HEADER_OFFSET_HASH_HI1, true);
  return hex8(hi1) + hex8(hi0) + hex8(lo1) + hex8(lo0);
}
function readParseOptionsKey(data) {
  return data.getUint32(HEADER_OFFSET_PARSE_OPTIONS, true).toString();
}
function hex8(n) {
  return (n >>> 0).toString(16).padStart(8, "0");
}
function modifierToFlag(kind) {
  switch (kind) {
    case SyntaxKind.StaticKeyword:
      return ModifierFlags.Static;
    case SyntaxKind.PublicKeyword:
      return ModifierFlags.Public;
    case SyntaxKind.ProtectedKeyword:
      return ModifierFlags.Protected;
    case SyntaxKind.PrivateKeyword:
      return ModifierFlags.Private;
    case SyntaxKind.AbstractKeyword:
      return ModifierFlags.Abstract;
    case SyntaxKind.AccessorKeyword:
      return ModifierFlags.Accessor;
    case SyntaxKind.ExportKeyword:
      return ModifierFlags.Export;
    case SyntaxKind.DeclareKeyword:
      return ModifierFlags.Ambient;
    case SyntaxKind.ConstKeyword:
      return ModifierFlags.Const;
    case SyntaxKind.DefaultKeyword:
      return ModifierFlags.Default;
    case SyntaxKind.AsyncKeyword:
      return ModifierFlags.Async;
    case SyntaxKind.ReadonlyKeyword:
      return ModifierFlags.Readonly;
    case SyntaxKind.OverrideKeyword:
      return ModifierFlags.Override;
    case SyntaxKind.InKeyword:
      return ModifierFlags.In;
    case SyntaxKind.OutKeyword:
      return ModifierFlags.Out;
    case SyntaxKind.Decorator:
      return ModifierFlags.Decorator;
    default:
      return ModifierFlags.None;
  }
}

class RemoteNodeBase {
  parent;
  view;
  index;
  _byteIndex;
  constructor(view, index, parent, byteIndex) {
    this.view = view;
    this.index = index;
    this.parent = parent;
    this._byteIndex = byteIndex;
  }
  get kind() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_KIND, true);
  }
  get pos() {
    return this.view.getInt32(this._byteIndex + NODE_OFFSET_POS, true);
  }
  get end() {
    return this.view.getInt32(this._byteIndex + NODE_OFFSET_END, true);
  }
  get next() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_NEXT, true);
  }
  get parentIndex() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_PARENT, true);
  }
  get data() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_DATA, true);
  }
  get dataType() {
    return this.data & NODE_DATA_TYPE_MASK;
  }
  get childMask() {
    if (this.dataType !== NODE_DATA_TYPE_CHILDREN) {
      return -1;
    }
    return this.data & NODE_CHILD_MASK;
  }
  getFileText(start, end) {
    return this.sourceFile._decoder.decode(new Uint8Array(this.view.buffer, this.view.byteOffset + this.sourceFile._offsetStringTable + start, end - start));
  }
  get sourceFile() {
    throw new Error("sourceFile not available on base");
  }
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/node.generated.js
class RemoteNodeList extends Array {
  static get [Symbol.species]() {
    return Array;
  }
  parent;
  hasTrailingComma;
  transformFlags = 0;
  view;
  index;
  _byteIndex;
  _cursorIndex = 0;
  _cursorNodeIndex = 0;
  get pos() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_POS, true);
  }
  get end() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_END, true);
  }
  get next() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_NEXT, true);
  }
  get data() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_DATA, true);
  }
  sourceFile;
  constructor(view, index, parent, sourceFile, offsetNodes) {
    super();
    this.view = view;
    this.index = index;
    this.parent = parent;
    this.sourceFile = sourceFile;
    this._byteIndex = offsetNodes + index * NODE_LEN;
    this.length = this.data;
    this._cursorNodeIndex = index + 1;
    const length = this.length;
    for (let i = 16;i < length; i++) {
      Object.defineProperty(this, i, {
        get() {
          return this.at(i);
        }
      });
    }
  }
  get 0() {
    return this.at(0);
  }
  get 1() {
    return this.at(1);
  }
  get 2() {
    return this.at(2);
  }
  get 3() {
    return this.at(3);
  }
  get 4() {
    return this.at(4);
  }
  get 5() {
    return this.at(5);
  }
  get 6() {
    return this.at(6);
  }
  get 7() {
    return this.at(7);
  }
  get 8() {
    return this.at(8);
  }
  get 9() {
    return this.at(9);
  }
  get 10() {
    return this.at(10);
  }
  get 11() {
    return this.at(11);
  }
  get 12() {
    return this.at(12);
  }
  get 13() {
    return this.at(13);
  }
  get 14() {
    return this.at(14);
  }
  get 15() {
    return this.at(15);
  }
  *[Symbol.iterator]() {
    if (!this.length)
      return;
    let next = this.index + 1;
    while (next) {
      const child = this.getOrCreateChildAtNodeIndex(next);
      next = child.next;
      yield child;
    }
  }
  forEachNode(visitNode) {
    if (!this.length)
      return;
    let next = this.index + 1;
    while (next) {
      const child = this.getOrCreateChildAtNodeIndex(next);
      next = child.next;
      const result = visitNode(child);
      if (result)
        return result;
    }
  }
  at(index) {
    if (!Number.isInteger(index)) {
      return;
    }
    if (index >= this.data || index < 0 && -index > this.data) {
      return;
    }
    if (index < 0) {
      index = this.length + index;
    }
    const offsetNodes = this.sourceFile._offsetNodes;
    let i;
    let next;
    if (index >= this._cursorIndex) {
      i = this._cursorIndex;
      next = this._cursorNodeIndex;
    } else {
      i = 0;
      next = this.index + 1;
    }
    for (;i < index; i++) {
      next = this.view.getUint32(offsetNodes + next * NODE_LEN + NODE_OFFSET_NEXT, true);
    }
    this._cursorIndex = index;
    this._cursorNodeIndex = next;
    return this.getOrCreateChildAtNodeIndex(next);
  }
  getOrCreateChildAtNodeIndex(index) {
    let child = this.sourceFile.nodes[index];
    if (!child) {
      const kind = this.view.getUint32(this.sourceFile._offsetNodes + index * NODE_LEN + NODE_OFFSET_KIND, true);
      if (kind === KIND_NODE_LIST) {
        throw new Error("NodeList cannot directly contain another NodeList");
      }
      const sf = this.sourceFile;
      child = new RemoteNode(this.view, index, this.parent, sf, sf._offsetNodes);
      sf.nodes[index] = child;
      sf._timing?.recordMaterialization();
    }
    return child;
  }
  __print() {
    const result = [];
    result.push(`kind: NodeList`);
    result.push(`index: ${this.index}`);
    result.push(`byteIndex: ${this._byteIndex}`);
    result.push(`length: ${this.length}`);
    return result.join(`
`);
  }
}

class RemoteNode extends RemoteNodeBase {
  static NODE_LEN = NODE_LEN;
  get sourceFile() {
    return this._sourceFile;
  }
  _sourceFile;
  get id() {
    return `${this.index}.${this.kind}.${this.sourceFile.path}`;
  }
  constructor(view, index, parent, sourceFile, offsetNodes) {
    super(view, index, parent, offsetNodes + index * NODE_LEN);
    this._sourceFile = sourceFile;
  }
  forEachChild(visitNode, visitList) {
    if (this.hasChildren()) {
      let next = this.index + 1;
      do {
        const child = this.getOrCreateChildAtNodeIndex(next);
        if (child instanceof RemoteNodeList) {
          if (visitList) {
            const result = visitList(child);
            if (result) {
              return result;
            }
          } else {
            const result = child.forEachNode(visitNode);
            if (result) {
              return result;
            }
          }
        } else if (child.kind !== SyntaxKind.JSDoc) {
          const result = visitNode(child);
          if (result) {
            return result;
          }
        }
        next = child.next;
      } while (next);
    }
  }
  get jsDoc() {
    if (!this.hasChildren()) {
      return;
    }
    let result;
    let next = this.index + 1;
    do {
      const child = this.getOrCreateChildAtNodeIndex(next);
      if (!(child instanceof RemoteNodeList) && child.kind === SyntaxKind.JSDoc) {
        (result ??= []).push(child);
      }
      next = child.next;
    } while (next);
    return result;
  }
  getSourceFile() {
    return this.sourceFile;
  }
  getStart(sourceFile, includeJsDocComment) {
    return getTokenPosOfNode(this, sourceFile ?? this.getSourceFile(), includeJsDocComment);
  }
  getFullStart() {
    return this.pos;
  }
  getEnd() {
    return this.end;
  }
  getWidth(sourceFile) {
    return this.getEnd() - this.getStart(sourceFile);
  }
  getFullWidth() {
    return this.end - this.pos;
  }
  getLeadingTriviaWidth(sourceFile) {
    return this.getStart(sourceFile) - this.pos;
  }
  getFullText(sourceFile) {
    return (sourceFile ?? this.getSourceFile()).text.substring(this.pos, this.end);
  }
  getText(sourceFile) {
    sourceFile ??= this.getSourceFile();
    return sourceFile.text.substring(this.getStart(sourceFile), this.end);
  }
  getString(index) {
    const offsetStringTableOffsets = this.sourceFile._offsetStringTableOffsets;
    const start = this.view.getUint32(offsetStringTableOffsets + index * 4, true);
    const end = this.view.getUint32(offsetStringTableOffsets + (index + 1) * 4, true);
    const offsetStringTable = this.sourceFile._offsetStringTable;
    const text = new Uint8Array(this.view.buffer, this.view.byteOffset + offsetStringTable + start, end - start);
    return this.sourceFile._decoder.decode(text);
  }
  getOrCreateChildAtNodeIndex(index) {
    let child = this.sourceFile.nodes[index];
    if (!child) {
      const sf = this.sourceFile;
      const offsetNodes = sf._offsetNodes;
      const kind = this.view.getUint32(offsetNodes + index * NODE_LEN + NODE_OFFSET_KIND, true);
      child = kind === KIND_NODE_LIST ? new RemoteNodeList(this.view, index, this, sf, offsetNodes) : new RemoteNode(this.view, index, this, sf, offsetNodes);
      sf.nodes[index] = child;
      sf._timing?.recordMaterialization();
    }
    return child;
  }
  hasChildren() {
    if (this._byteIndex >= this.view.byteLength - NODE_LEN) {
      return false;
    }
    const nextNodeParent = this.view.getUint32(this.sourceFile._offsetNodes + (this.index + 1) * NODE_LEN + NODE_OFFSET_PARENT, true);
    return nextNodeParent === this.index;
  }
  getNamedChild(propertyName) {
    const kind = this.kind;
    const propertyNames = childProperties[kind];
    if (!propertyNames) {
      return;
    }
    const order = propertyNames.indexOf(propertyName);
    if (order === -1) {
      return;
    }
    return this.getChildAtOrder(order);
  }
  getChildAtOrder(order) {
    const mask = this.childMask;
    if (!(mask & 1 << order)) {
      return;
    }
    const propertyIndex = order - popcount8[~(mask | 255 << order & 255) & 255];
    let childIndex = this.index + 1;
    for (let i = 0;i < propertyIndex; i++) {
      childIndex = this.view.getUint32(this.sourceFile._offsetNodes + childIndex * NODE_LEN + NODE_OFFSET_NEXT, true);
    }
    return this.getOrCreateChildAtNodeIndex(childIndex);
  }
  __print() {
    const result = [];
    result.push(`index: ${this.index}`);
    result.push(`byteIndex: ${this._byteIndex}`);
    result.push(`kind: ${SyntaxKind[this.kind]}`);
    result.push(`pos: ${this.pos}`);
    result.push(`end: ${this.end}`);
    result.push(`next: ${this.next}`);
    result.push(`parent: ${this.parentIndex}`);
    result.push(`data: ${this.data.toString(2).padStart(32, "0")}`);
    const dataType = this.dataType === NODE_DATA_TYPE_CHILDREN ? "children" : this.dataType === NODE_DATA_TYPE_STRING ? "string" : "extended";
    result.push(`dataType: ${dataType}`);
    if (this.dataType === NODE_DATA_TYPE_CHILDREN) {
      result.push(`childMask: ${this.childMask.toString(2).padStart(8, "0")}`);
      result.push(`childProperties: ${childProperties[this.kind]?.join(", ")}`);
    }
    return result.join(`
`);
  }
  __printChildren() {
    const result = [];
    let next = this.index + 1;
    while (next) {
      const child = this.getOrCreateChildAtNodeIndex(next);
      next = child.next;
      result.push(child.__print());
    }
    return result.join(`

`);
  }
  __printSubtree() {
    const result = [this.__print()];
    this.forEachChild(function visitNode(node) {
      result.push(node.__print());
      node.forEachChild(visitNode);
    }, (visitList) => {
      result.push(visitList.__print());
    });
    return result.join(`

`);
  }
  get containsOnlyTriviaWhiteSpaces() {
    return (this.data & 1 << 24) !== 0;
  }
  get isArrayType() {
    return (this.data & 1 << 24) !== 0;
  }
  get isBracketed() {
    return (this.data & 1 << 24) !== 0;
  }
  get isExportEquals() {
    return (this.data & 1 << 24) !== 0;
  }
  get isNameFirst() {
    return (this.data & 1 << 25) !== 0;
  }
  get isTypeOf() {
    return (this.data & 1 << 24) !== 0;
  }
  get isTypeOnly() {
    return (this.data & 1 << 24) !== 0;
  }
  get multiLine() {
    return (this.data & 1 << 24) !== 0;
  }
  get keyword() {
    switch (this.kind) {
      case SyntaxKind.ModuleDeclaration:
        return this.data >> 24 & 1 ? SyntaxKind.NamespaceKeyword : SyntaxKind.ModuleKeyword;
    }
  }
  get keywordToken() {
    switch (this.kind) {
      case SyntaxKind.MetaProperty:
        return this.data >> 24 & 1 ? SyntaxKind.NewKeyword : SyntaxKind.ImportKeyword;
    }
  }
  get operator() {
    switch (this.kind) {
      case SyntaxKind.PrefixUnaryExpression: {
        const idx = this.data >> 24 & 7;
        if (idx === 1)
          return SyntaxKind.MinusToken;
        if (idx === 2)
          return SyntaxKind.TildeToken;
        if (idx === 3)
          return SyntaxKind.ExclamationToken;
        if (idx === 4)
          return SyntaxKind.PlusPlusToken;
        if (idx === 5)
          return SyntaxKind.MinusMinusToken;
        return SyntaxKind.PlusToken;
      }
      case SyntaxKind.PostfixUnaryExpression:
        return this.data >> 24 & 1 ? SyntaxKind.MinusMinusToken : SyntaxKind.PlusPlusToken;
      case SyntaxKind.TypeOperator: {
        const idx = this.data >> 24 & 3;
        if (idx === 1)
          return SyntaxKind.ReadonlyKeyword;
        if (idx === 2)
          return SyntaxKind.UniqueKeyword;
        return SyntaxKind.KeyOfKeyword;
      }
    }
  }
  get phaseModifier() {
    switch (this.kind) {
      case SyntaxKind.ImportClause: {
        const idx = this.data >> 24 & 3;
        if (idx === 0)
          return;
        return idx === 1 ? SyntaxKind.TypeKeyword : idx === 2 ? SyntaxKind.DeferKeyword : undefined;
      }
    }
  }
  get token() {
    switch (this.kind) {
      case SyntaxKind.HeritageClause:
        return this.data >> 24 & 1 ? SyntaxKind.ImplementsKeyword : SyntaxKind.ExtendsKeyword;
      case SyntaxKind.ImportAttributes:
        return this.data >> 25 & 1 ? SyntaxKind.AssertKeyword : SyntaxKind.WithKeyword;
    }
  }
  get templateFlags() {
    switch (this.kind) {
      case SyntaxKind.TemplateHead:
      case SyntaxKind.TemplateMiddle:
      case SyntaxKind.TemplateTail:
        const extendedDataOffset = this.sourceFile._offsetExtendedData + (this.data & NODE_EXTENDED_DATA_MASK);
        return this.view.getUint32(extendedDataOffset + 8, true);
    }
  }
  get tokenFlags() {
    switch (this.kind) {
      case SyntaxKind.StringLiteral:
      case SyntaxKind.NumericLiteral:
      case SyntaxKind.BigIntLiteral:
      case SyntaxKind.RegularExpressionLiteral:
        const extendedDataOffset = this.sourceFile._offsetExtendedData + (this.data & NODE_EXTENDED_DATA_MASK);
        return this.view.getUint32(extendedDataOffset + 4, true);
      default:
        return 0;
    }
  }
  get argument() {
    return this.getNamedChild("argument");
  }
  get argumentExpression() {
    return this.getNamedChild("argumentExpression");
  }
  get arguments() {
    return this.getNamedChild("arguments");
  }
  get assertsModifier() {
    return this.getNamedChild("assertsModifier");
  }
  get asteriskToken() {
    return this.getNamedChild("asteriskToken");
  }
  get attributes() {
    return this.getNamedChild("attributes");
  }
  get awaitModifier() {
    return this.getNamedChild("awaitModifier");
  }
  get block() {
    return this.getNamedChild("block");
  }
  get body() {
    return this.getNamedChild("body");
  }
  get caseBlock() {
    return this.getNamedChild("caseBlock");
  }
  get catchClause() {
    return this.getNamedChild("catchClause");
  }
  get checkType() {
    return this.getNamedChild("checkType");
  }
  get children() {
    return this.getNamedChild("children");
  }
  get className() {
    return this.getNamedChild("className");
  }
  get clauses() {
    return this.getNamedChild("clauses");
  }
  get closingElement() {
    return this.getNamedChild("closingElement");
  }
  get closingFragment() {
    return this.getNamedChild("closingFragment");
  }
  get colonToken() {
    return this.getNamedChild("colonToken");
  }
  get comment() {
    return this.getNamedChild("comment");
  }
  get condition() {
    return this.getNamedChild("condition");
  }
  get constraint() {
    return this.getNamedChild("constraint");
  }
  get declarationList() {
    return this.getNamedChild("declarationList");
  }
  get declarations() {
    return this.getNamedChild("declarations");
  }
  get defaultType() {
    return this.getNamedChild("defaultType");
  }
  get dotDotDotToken() {
    return this.getNamedChild("dotDotDotToken");
  }
  get elements() {
    return this.getNamedChild("elements");
  }
  get elementType() {
    return this.getNamedChild("elementType");
  }
  get elseStatement() {
    return this.getNamedChild("elseStatement");
  }
  get endOfFileToken() {
    return this.getNamedChild("endOfFileToken");
  }
  get equalsGreaterThanToken() {
    return this.getNamedChild("equalsGreaterThanToken");
  }
  get equalsToken() {
    return this.getNamedChild("equalsToken");
  }
  get exclamationToken() {
    return this.getNamedChild("exclamationToken");
  }
  get exportClause() {
    return this.getNamedChild("exportClause");
  }
  get expression() {
    return this.getNamedChild("expression");
  }
  get exprName() {
    return this.getNamedChild("exprName");
  }
  get extendsType() {
    return this.getNamedChild("extendsType");
  }
  get falseType() {
    return this.getNamedChild("falseType");
  }
  get finallyBlock() {
    return this.getNamedChild("finallyBlock");
  }
  get head() {
    return this.getNamedChild("head");
  }
  get heritageClauses() {
    return this.getNamedChild("heritageClauses");
  }
  get importClause() {
    return this.getNamedChild("importClause");
  }
  get incrementor() {
    return this.getNamedChild("incrementor");
  }
  get indexType() {
    return this.getNamedChild("indexType");
  }
  get initializer() {
    return this.getNamedChild("initializer");
  }
  get jsdocPropertyTags() {
    return this.getNamedChild("jsdocPropertyTags");
  }
  get label() {
    return this.getNamedChild("label");
  }
  get left() {
    return this.getNamedChild("left");
  }
  get literal() {
    return this.getNamedChild("literal");
  }
  get members() {
    return this.getNamedChild("members");
  }
  get modifiers() {
    return this.getNamedChild("modifiers");
  }
  get moduleReference() {
    return this.getNamedChild("moduleReference");
  }
  get moduleSpecifier() {
    return this.getNamedChild("moduleSpecifier");
  }
  get name() {
    return this.getNamedChild("name");
  }
  get namedBindings() {
    return this.getNamedChild("namedBindings");
  }
  get nameExpression() {
    return this.getNamedChild("nameExpression");
  }
  get namespace() {
    return this.getNamedChild("namespace");
  }
  get nameType() {
    return this.getNamedChild("nameType");
  }
  get objectAssignmentInitializer() {
    return this.getNamedChild("objectAssignmentInitializer");
  }
  get objectType() {
    return this.getNamedChild("objectType");
  }
  get openingElement() {
    return this.getNamedChild("openingElement");
  }
  get openingFragment() {
    return this.getNamedChild("openingFragment");
  }
  get operand() {
    return this.getNamedChild("operand");
  }
  get operatorToken() {
    return this.getNamedChild("operatorToken");
  }
  get parameterName() {
    return this.getNamedChild("parameterName");
  }
  get parameters() {
    return this.getNamedChild("parameters");
  }
  get postfixToken() {
    return this.getNamedChild("postfixToken");
  }
  get properties() {
    return this.getNamedChild("properties");
  }
  get propertyName() {
    return this.getNamedChild("propertyName");
  }
  get qualifier() {
    return this.getNamedChild("qualifier");
  }
  get questionDotToken() {
    return this.getNamedChild("questionDotToken");
  }
  get questionToken() {
    return this.getNamedChild("questionToken");
  }
  get readonlyToken() {
    return this.getNamedChild("readonlyToken");
  }
  get right() {
    return this.getNamedChild("right");
  }
  get statement() {
    return this.getNamedChild("statement");
  }
  get statements() {
    return this.getNamedChild("statements");
  }
  get tag() {
    return this.getNamedChild("tag");
  }
  get tagName() {
    return this.getNamedChild("tagName");
  }
  get tags() {
    return this.getNamedChild("tags");
  }
  get template() {
    return this.getNamedChild("template");
  }
  get templateSpans() {
    return this.getNamedChild("templateSpans");
  }
  get thenStatement() {
    return this.getNamedChild("thenStatement");
  }
  get thisArg() {
    return this.getNamedChild("thisArg");
  }
  get trueType() {
    return this.getNamedChild("trueType");
  }
  get tryBlock() {
    return this.getNamedChild("tryBlock");
  }
  get tupleNameSource() {
    return this.getNamedChild("tupleNameSource");
  }
  get type() {
    return this.getNamedChild("type");
  }
  get typeArguments() {
    return this.getNamedChild("typeArguments");
  }
  get typeExpression() {
    return this.getNamedChild("typeExpression");
  }
  get typeName() {
    return this.getNamedChild("typeName");
  }
  get typeParameter() {
    return this.getNamedChild("typeParameter");
  }
  get typeParameters() {
    return this.getNamedChild("typeParameters");
  }
  get types() {
    return this.getNamedChild("types");
  }
  get value() {
    return this.getNamedChild("value");
  }
  get variableDeclaration() {
    return this.getNamedChild("variableDeclaration");
  }
  get whenFalse() {
    return this.getNamedChild("whenFalse");
  }
  get whenTrue() {
    return this.getNamedChild("whenTrue");
  }
  get text() {
    switch (this.kind) {
      case SyntaxKind.Identifier:
      case SyntaxKind.PrivateIdentifier:
      case SyntaxKind.JsxText:
      case SyntaxKind.JSDocText:
      case SyntaxKind.JSDocLink:
      case SyntaxKind.JSDocLinkPlain:
      case SyntaxKind.JSDocLinkCode: {
        const stringIndex = this.data & NODE_STRING_INDEX_MASK;
        return this.getString(stringIndex);
      }
      case SyntaxKind.StringLiteral:
      case SyntaxKind.NumericLiteral:
      case SyntaxKind.BigIntLiteral:
      case SyntaxKind.RegularExpressionLiteral:
      case SyntaxKind.NoSubstitutionTemplateLiteral:
      case SyntaxKind.TemplateHead:
      case SyntaxKind.TemplateMiddle:
      case SyntaxKind.TemplateTail:
      case SyntaxKind.SourceFile: {
        const extendedDataOffset = this.sourceFile._offsetExtendedData + (this.data & NODE_EXTENDED_DATA_MASK);
        const stringIndex = this.view.getUint32(extendedDataOffset, true);
        return this.getString(stringIndex);
      }
    }
  }
  get rawText() {
    switch (this.kind) {
      case SyntaxKind.TemplateHead:
      case SyntaxKind.TemplateMiddle:
      case SyntaxKind.TemplateTail:
        const extendedDataOffset = this.sourceFile._offsetExtendedData + (this.data & NODE_EXTENDED_DATA_MASK);
        const stringIndex = this.view.getUint32(extendedDataOffset + 4, true);
        return this.getString(stringIndex);
    }
  }
  get flags() {
    return this.view.getUint32(this._byteIndex + NODE_OFFSET_FLAGS, true);
  }
  get modifierFlags() {
    const mods = this.modifiers;
    if (!mods)
      return ModifierFlags.None;
    let flags = ModifierFlags.None;
    for (const mod of mods) {
      flags |= modifierToFlag(mod.kind);
    }
    return flags;
  }
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/node/node.js
var NO_STRUCTURED_DATA2 = 4294967295;

class RemoteSourceFile extends RemoteNode {
  nodes;
  _offsetNodes;
  _offsetStringTableOffsets;
  _offsetStringTable;
  _offsetExtendedData;
  _offsetStructuredData;
  _decoder;
  _timing;
  _lineStarts;
  _cachedText;
  _cachedReferencedFiles;
  _cachedTypeReferenceDirectives;
  _cachedLibReferenceDirectives;
  _cachedImports;
  _cachedModuleAugmentations;
  _cachedAmbientModuleNames;
  constructor(data, decoder, timing) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const offsetNodes = view.getUint32(HEADER_OFFSET_NODES, true);
    super(view, 1, undefined, undefined, offsetNodes);
    this._sourceFile = this;
    this._offsetNodes = offsetNodes;
    this._offsetStringTableOffsets = view.getUint32(HEADER_OFFSET_STRING_TABLE_OFFSETS, true);
    this._offsetStringTable = view.getUint32(HEADER_OFFSET_STRING_TABLE, true);
    this._offsetExtendedData = view.getUint32(HEADER_OFFSET_EXTENDED_DATA, true);
    this._offsetStructuredData = view.getUint32(HEADER_OFFSET_STRUCTURED_DATA, true);
    this._decoder = decoder;
    this._timing = timing;
    this.nodes = Array((view.byteLength - offsetNodes) / NODE_LEN);
    this.nodes[1] = this;
    timing?.recordSourceFileFetched(Math.max(0, this.nodes.length - 2));
  }
  readFileReferences(structuredDataOffset) {
    if (structuredDataOffset === NO_STRUCTURED_DATA2) {
      return [];
    }
    const buf = new Uint8Array(this.view.buffer, this.view.byteOffset, this.view.byteLength);
    const reader = new MsgpackReader(buf, this._offsetStructuredData + structuredDataOffset);
    const count = reader.readArrayHeader();
    const result = [];
    for (let i = 0;i < count; i++) {
      reader.readArrayHeader();
      const pos = reader.readUint();
      const end = reader.readUint();
      const fileName = reader.readString();
      const resolutionMode = reader.readUint();
      const preserve = reader.readBool();
      result.push({ pos, end, fileName, resolutionMode, preserve });
    }
    return result;
  }
  readNodeIndexArray(structuredDataOffset) {
    if (structuredDataOffset === NO_STRUCTURED_DATA2) {
      return [];
    }
    const buf = new Uint8Array(this.view.buffer, this.view.byteOffset, this.view.byteLength);
    const reader = new MsgpackReader(buf, this._offsetStructuredData + structuredDataOffset);
    const count = reader.readArrayHeader();
    const result = [];
    for (let i = 0;i < count; i++) {
      const nodeIndex = reader.readUint();
      result.push(this.getOrCreateNodeAtIndex(nodeIndex));
    }
    return result;
  }
  readStringArray(structuredDataOffset) {
    if (structuredDataOffset === NO_STRUCTURED_DATA2) {
      return [];
    }
    const buf = new Uint8Array(this.view.buffer, this.view.byteOffset, this.view.byteLength);
    const reader = new MsgpackReader(buf, this._offsetStructuredData + structuredDataOffset);
    const count = reader.readArrayHeader();
    const result = [];
    for (let i = 0;i < count; i++) {
      result.push(reader.readString());
    }
    return result;
  }
  getOrCreateNodeAtIndex(index) {
    let node = this.nodes[index];
    if (!node) {
      let parentIndex = this.view.getUint32(this._offsetNodes + index * NODE_LEN + NODE_OFFSET_PARENT, true);
      while (parentIndex !== index && this.view.getUint32(this._offsetNodes + parentIndex * NODE_LEN + NODE_OFFSET_KIND, true) === KIND_NODE_LIST) {
        parentIndex = this.view.getUint32(this._offsetNodes + parentIndex * NODE_LEN + NODE_OFFSET_PARENT, true);
      }
      const parent = parentIndex === index ? this : this.getOrCreateNodeAtIndex(parentIndex);
      node = new RemoteNode(this.view, index, parent, this, this._offsetNodes);
      this.nodes[index] = node;
      this._timing?.recordMaterialization();
    }
    return node;
  }
  get extendedDataOffset() {
    return this._offsetExtendedData + (this.data & NODE_EXTENDED_DATA_MASK);
  }
  get fileName() {
    const stringIndex = this.view.getUint32(this.extendedDataOffset + 4, true);
    return this.getString(stringIndex);
  }
  get path() {
    const stringIndex = this.view.getUint32(this.extendedDataOffset + 8, true);
    return this.getString(stringIndex);
  }
  get languageVariant() {
    return this.view.getUint32(this.extendedDataOffset + 12, true);
  }
  get scriptKind() {
    return this.view.getUint32(this.extendedDataOffset + 16, true);
  }
  get referencedFiles() {
    if (this._cachedReferencedFiles !== undefined)
      return this._cachedReferencedFiles;
    const offset = this.view.getUint32(this.extendedDataOffset + 20, true);
    const files = this.readFileReferences(offset);
    this._cachedReferencedFiles = files;
    return files;
  }
  get typeReferenceDirectives() {
    if (this._cachedTypeReferenceDirectives !== undefined)
      return this._cachedTypeReferenceDirectives;
    const offset = this.view.getUint32(this.extendedDataOffset + 24, true);
    const directives = this.readFileReferences(offset);
    this._cachedTypeReferenceDirectives = directives;
    return directives;
  }
  get libReferenceDirectives() {
    if (this._cachedLibReferenceDirectives !== undefined)
      return this._cachedLibReferenceDirectives;
    const offset = this.view.getUint32(this.extendedDataOffset + 28, true);
    const directives = this.readFileReferences(offset);
    this._cachedLibReferenceDirectives = directives;
    return directives;
  }
  get imports() {
    if (this._cachedImports !== undefined)
      return this._cachedImports;
    const offset = this.view.getUint32(this.extendedDataOffset + 32, true);
    const imports = this.readNodeIndexArray(offset);
    this._cachedImports = imports;
    return imports;
  }
  get moduleAugmentations() {
    if (this._cachedModuleAugmentations !== undefined)
      return this._cachedModuleAugmentations;
    const offset = this.view.getUint32(this.extendedDataOffset + 36, true);
    const moduleAugmentations = this.readNodeIndexArray(offset);
    this._cachedModuleAugmentations = moduleAugmentations;
    return moduleAugmentations;
  }
  get ambientModuleNames() {
    if (this._cachedAmbientModuleNames !== undefined)
      return this._cachedAmbientModuleNames;
    const offset = this.view.getUint32(this.extendedDataOffset + 40, true);
    const names = this.readStringArray(offset);
    this._cachedAmbientModuleNames = names;
    return names;
  }
  get externalModuleIndicator() {
    const nodeIndex = this.view.getUint32(this.extendedDataOffset + 44, true);
    if (nodeIndex === 0)
      return;
    if (nodeIndex === this.index)
      return true;
    return this.getOrCreateNodeAtIndex(nodeIndex);
  }
  get isDeclarationFile() {
    return (this.flags & NodeFlags.Ambient) !== 0;
  }
  get text() {
    if (this._cachedText !== undefined)
      return this._cachedText;
    const text = super.text;
    this._cachedText = text;
    return text;
  }
  getLineStarts() {
    return this._lineStarts ??= computeLineStarts(this.text ?? "");
  }
  getLineAndCharacterOfPosition(position) {
    const lineStarts = this.getLineStarts();
    const line = computeLineOfPosition(lineStarts, position);
    return { line, character: position - lineStarts[line] };
  }
  getPositionOfLineAndCharacter(line, character) {
    const lineStarts = this.getLineStarts();
    if (line < 0 || line >= lineStarts.length) {
      throw new Error(`Bad line number. Line: ${line}, lineStarts.length: ${lineStarts.length}`);
    }
    return lineStarts[line] + character;
  }
}
function computeLineOfPosition(lineStarts, position) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = low + (high - low >> 1);
    const value = lineStarts[middle];
    if (value < position) {
      low = middle + 1;
    } else if (value > position) {
      high = middle - 1;
    } else {
      return middle;
    }
  }
  return low - 1;
}
function parseNodeHandle(handle) {
  const firstDot = handle.indexOf(".");
  if (firstDot === -1) {
    throw new Error(`Invalid node handle: ${handle}`);
  }
  const secondDot = handle.indexOf(".", firstDot + 1);
  if (secondDot === -1) {
    throw new Error(`Invalid node handle: ${handle}`);
  }
  return {
    index: parseInt(handle.slice(0, firstDot), 10),
    kind: parseInt(handle.slice(firstDot + 1, secondDot), 10),
    path: handle.slice(secondDot + 1)
  };
}
function decodeNode(data) {
  const sf = new RemoteSourceFile(data, new Wtf8Decoder);
  return sf;
}
function getNodeId(node) {
  if (!(node instanceof RemoteNode)) {
    throw new Error("getNodeId requires a RemoteNode");
  }
  return node.id;
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/path.js
var CharacterCodesSlash = 47;
var CharacterCodesBackslash = 92;
var CharacterCodesColon = 58;
var CharacterCodesPercent = 37;
var CharacterCodes3 = 51;
var CharacterCodesa = 97;
var CharacterCodesz = 122;
var CharacterCodesA = 65;
var CharacterCodesZ = 90;
var CharacterCodesDot = 46;
var directorySeparator = "/";
var altDirectorySeparator = "\\";
var urlSchemeSeparator = "://";
var backslashRegExp = /\\/g;
var relativePathSegmentRegExp = /\/\/|(?:^|\/)\.\.?(?:$|\/)/;
function isAnyDirectorySeparator(charCode) {
  return charCode === CharacterCodesSlash || charCode === CharacterCodesBackslash;
}
function isVolumeCharacter(charCode) {
  return charCode >= CharacterCodesa && charCode <= CharacterCodesz || charCode >= CharacterCodesA && charCode <= CharacterCodesZ;
}
function getFileUrlVolumeSeparatorEnd(url, start) {
  const ch0 = url.charCodeAt(start);
  if (ch0 === CharacterCodesColon)
    return start + 1;
  if (ch0 === CharacterCodesPercent && url.charCodeAt(start + 1) === CharacterCodes3) {
    const ch2 = url.charCodeAt(start + 2);
    if (ch2 === CharacterCodesa || ch2 === CharacterCodesA)
      return start + 3;
  }
  return -1;
}
function getRootLength(path) {
  const rootLength = getEncodedRootLength(path);
  return rootLength < 0 ? ~rootLength : rootLength;
}
function getEncodedRootLength(path) {
  if (!path)
    return 0;
  const ch0 = path.charCodeAt(0);
  if (ch0 === CharacterCodesSlash || ch0 === CharacterCodesBackslash) {
    if (path.charCodeAt(1) !== ch0)
      return 1;
    const p1 = path.indexOf(ch0 === CharacterCodesSlash ? directorySeparator : altDirectorySeparator, 2);
    if (p1 < 0)
      return path.length;
    return p1 + 1;
  }
  if (isVolumeCharacter(ch0) && path.charCodeAt(1) === CharacterCodesColon) {
    const ch2 = path.charCodeAt(2);
    if (ch2 === CharacterCodesSlash || ch2 === CharacterCodesBackslash)
      return 3;
    if (path.length === 2)
      return 2;
  }
  const schemeEnd = path.indexOf(urlSchemeSeparator);
  if (schemeEnd !== -1) {
    const authorityStart = schemeEnd + urlSchemeSeparator.length;
    const authorityEnd = path.indexOf(directorySeparator, authorityStart);
    if (authorityEnd !== -1) {
      const scheme = path.slice(0, schemeEnd);
      const authority = path.slice(authorityStart, authorityEnd);
      if (scheme === "file" && (authority === "" || authority === "localhost") && isVolumeCharacter(path.charCodeAt(authorityEnd + 1))) {
        const volumeSeparatorEnd = getFileUrlVolumeSeparatorEnd(path, authorityEnd + 2);
        if (volumeSeparatorEnd !== -1) {
          if (path.charCodeAt(volumeSeparatorEnd) === CharacterCodesSlash) {
            return ~(volumeSeparatorEnd + 1);
          }
          if (volumeSeparatorEnd === path.length) {
            return ~volumeSeparatorEnd;
          }
        }
      }
      return ~(authorityEnd + 1);
    }
    return ~path.length;
  }
  return 0;
}
function hasTrailingDirectorySeparator(path) {
  return path.length > 0 && isAnyDirectorySeparator(path.charCodeAt(path.length - 1));
}
function removeTrailingDirectorySeparator(path) {
  if (hasTrailingDirectorySeparator(path)) {
    return path.substr(0, path.length - 1);
  }
  return path;
}
function ensureTrailingDirectorySeparator(path) {
  if (!hasTrailingDirectorySeparator(path)) {
    return path + directorySeparator;
  }
  return path;
}
function normalizeSlashes(path) {
  return path.includes("\\") ? path.replace(backslashRegExp, directorySeparator) : path;
}
function combinePaths(path, ...paths) {
  if (path)
    path = normalizeSlashes(path);
  for (let relativePath of paths) {
    if (!relativePath)
      continue;
    relativePath = normalizeSlashes(relativePath);
    if (!path || getRootLength(relativePath) !== 0) {
      path = relativePath;
    } else {
      path = ensureTrailingDirectorySeparator(path) + relativePath;
    }
  }
  return path;
}
function simpleNormalizePath(path) {
  if (!relativePathSegmentRegExp.test(path)) {
    return path;
  }
  let simplified = path.replace(/\/\.\//g, "/");
  if (simplified.startsWith("./")) {
    simplified = simplified.slice(2);
  }
  if (simplified !== path) {
    path = simplified;
    if (!relativePathSegmentRegExp.test(path)) {
      return path;
    }
  }
  return;
}
function getNormalizedAbsolutePath(path, currentDirectory) {
  let rootLength = getRootLength(path);
  if (rootLength === 0 && currentDirectory) {
    path = combinePaths(currentDirectory, path);
    rootLength = getRootLength(path);
  } else {
    path = normalizeSlashes(path);
  }
  const simpleNormalized = simpleNormalizePath(path);
  if (simpleNormalized !== undefined) {
    return simpleNormalized.length > rootLength ? removeTrailingDirectorySeparator(simpleNormalized) : simpleNormalized;
  }
  const length = path.length;
  const root = path.substring(0, rootLength);
  let normalized;
  let index = rootLength;
  let segmentStart = index;
  let normalizedUpTo = index;
  let seenNonDotDotSegment = rootLength !== 0;
  while (index < length) {
    segmentStart = index;
    let ch = path.charCodeAt(index);
    while (ch === CharacterCodesSlash && index + 1 < length) {
      index++;
      ch = path.charCodeAt(index);
    }
    if (index > segmentStart) {
      normalized ??= path.substring(0, segmentStart - 1);
      segmentStart = index;
    }
    let segmentEnd = path.indexOf(directorySeparator, index + 1);
    if (segmentEnd === -1) {
      segmentEnd = length;
    }
    const segmentLength = segmentEnd - segmentStart;
    if (segmentLength === 1 && path.charCodeAt(index) === CharacterCodesDot) {
      normalized ??= path.substring(0, normalizedUpTo);
    } else if (segmentLength === 2 && path.charCodeAt(index) === CharacterCodesDot && path.charCodeAt(index + 1) === CharacterCodesDot) {
      if (!seenNonDotDotSegment) {
        if (normalized !== undefined) {
          normalized += normalized.length === rootLength ? ".." : "/..";
        } else {
          normalizedUpTo = index + 2;
        }
      } else if (normalized === undefined) {
        if (normalizedUpTo - 2 >= 0) {
          normalized = path.substring(0, Math.max(rootLength, path.lastIndexOf(directorySeparator, normalizedUpTo - 2)));
        } else {
          normalized = path.substring(0, normalizedUpTo);
        }
      } else {
        const lastSlash = normalized.lastIndexOf(directorySeparator);
        if (lastSlash !== -1) {
          normalized = normalized.substring(0, Math.max(rootLength, lastSlash));
        } else {
          normalized = root;
        }
        if (normalized.length === rootLength) {
          seenNonDotDotSegment = rootLength !== 0;
        }
      }
    } else if (normalized !== undefined) {
      if (normalized.length !== rootLength) {
        normalized += directorySeparator;
      }
      seenNonDotDotSegment = true;
      normalized += path.substring(segmentStart, segmentEnd);
    } else {
      seenNonDotDotSegment = true;
      normalizedUpTo = segmentEnd;
    }
    index = segmentEnd + 1;
  }
  return normalized ?? (length > rootLength ? removeTrailingDirectorySeparator(path) : path);
}
function normalizePath(path) {
  path = normalizeSlashes(path);
  let normalized = simpleNormalizePath(path);
  if (normalized !== undefined) {
    return normalized;
  }
  normalized = getNormalizedAbsolutePath(path, "");
  return normalized && hasTrailingDirectorySeparator(path) ? ensureTrailingDirectorySeparator(normalized) : normalized;
}
function isRootedDiskPath(path) {
  return getEncodedRootLength(path) > 0;
}
function toPath(fileName, basePath, getCanonicalFileName) {
  const nonCanonicalizedPath = isRootedDiskPath(fileName) ? normalizePath(fileName) : getNormalizedAbsolutePath(fileName, basePath);
  return getCanonicalFileName(nonCanonicalizedPath);
}
function createGetCanonicalFileName(useCaseSensitiveFileNames) {
  return useCaseSensitiveFileNames ? identity : toLowerCase;
}
function identity(x) {
  return x;
}
function toLowerCase(s) {
  return s.toLowerCase();
}
var bundledScheme = "bundled:///";
function isBundled(path) {
  return path.startsWith(bundledScheme);
}
function splitVolumePath(path) {
  if (path.length >= 2 && isVolumeCharacter(path.charCodeAt(0)) && path.charCodeAt(1) === CharacterCodesColon) {
    return [path.substring(0, 2).toLowerCase(), path.substring(2), true];
  }
  return ["", path, false];
}
function documentURIToFileName(uri) {
  if (isBundled(uri)) {
    return uri;
  }
  if (uri.startsWith("file://")) {
    let parsed;
    try {
      parsed = new URL(uri);
    } catch {
      throw new Error("invalid file URI: " + uri);
    }
    if (parsed.host !== "") {
      return "//" + parsed.host + parsed.pathname;
    }
    const path = decodeURIComponent(parsed.pathname);
    if (path.length >= 3 && path.charCodeAt(0) === CharacterCodesSlash) {
      const [volume, rest, ok] = splitVolumePath(path.substring(1));
      if (ok) {
        return volume + rest;
      }
    }
    return path;
  }
  const colonIndex = uri.indexOf(":");
  if (colonIndex === -1) {
    throw new Error("invalid URI: " + uri);
  }
  const scheme = uri.substring(0, colonIndex);
  let path = uri.substring(colonIndex + 1);
  let authority = "ts-nul-authority";
  if (path.startsWith("//")) {
    const rest = path.substring(2);
    const slashIndex = rest.indexOf("/");
    if (slashIndex === -1) {
      throw new Error("invalid URI: " + uri);
    }
    authority = rest.substring(0, slashIndex);
    path = rest.substring(slashIndex + 1);
  }
  return "^/" + scheme + "/" + authority + "/" + path;
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/proto.js
function resolveFileName(identifier) {
  if (typeof identifier === "string") {
    return identifier;
  }
  return documentURIToFileName(identifier.uri);
}
function toUpdateSnapshotRequest(params) {
  const { openProject, openProjects, ...rest } = params ?? {};
  const mergedOpenProjects = openProject !== undefined ? [resolveFileName(openProject), ...openProjects ?? []] : openProjects;
  return {
    ...rest,
    ...mergedOpenProjects !== undefined ? { openProjects: mergedOpenProjects } : {}
  };
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/sourceFileCache.js
function refKey(snapshotId, projectId) {
  return `${snapshotId}:${projectId}`;
}

class SourceFileCache {
  cache = new Map;
  snapshotProjectPaths = new Map;
  getRetained(path, snapshotId, projectId) {
    const entries = this.cache.get(path);
    if (!entries)
      return;
    const key = refKey(snapshotId, projectId);
    const entry = entries.find((e) => e.refs.has(key));
    return entry?.file;
  }
  set(path, file, parseOptionsKey, contentHash, snapshotId, projectId) {
    let entries = this.cache.get(path);
    if (!entries) {
      entries = [];
      this.cache.set(path, entries);
    }
    const ref = refKey(snapshotId, projectId);
    const existing = entries.find((e) => e.parseOptionsKey === parseOptionsKey && e.contentHash === contentHash);
    if (existing) {
      existing.refs.add(ref);
      this.trackPath(snapshotId, projectId, path);
      return existing.file;
    }
    entries.push({ file, contentHash, parseOptionsKey, refs: new Set([ref]) });
    this.trackPath(snapshotId, projectId, path);
    return file;
  }
  retainForSnapshot(newSnapshotId, previousSnapshotId, changes) {
    const prevProjectMap = this.snapshotProjectPaths.get(previousSnapshotId);
    if (!prevProjectMap)
      return;
    const removedProjects = new Set(changes?.removedProjects ?? []);
    const changedProjects = changes?.changedProjects ?? {};
    for (const [projectId, paths] of prevProjectMap) {
      if (removedProjects.has(projectId))
        continue;
      const projectChanges = changedProjects[projectId];
      let invalidPaths;
      if (projectChanges) {
        invalidPaths = new Set;
        for (const p of projectChanges.changedFiles ?? [])
          invalidPaths.add(p);
        for (const p of projectChanges.deletedFiles ?? [])
          invalidPaths.add(p);
      }
      const prevRef = refKey(previousSnapshotId, projectId);
      const newRef = refKey(newSnapshotId, projectId);
      for (const path of paths) {
        if (invalidPaths?.has(path))
          continue;
        const entries = this.cache.get(path);
        if (!entries)
          continue;
        for (const entry of entries) {
          if (entry.refs.has(prevRef)) {
            entry.refs.add(newRef);
            this.trackPath(newSnapshotId, projectId, path);
          }
        }
      }
    }
  }
  releaseSnapshot(snapshotId) {
    const projectMap = this.snapshotProjectPaths.get(snapshotId);
    if (!projectMap)
      return;
    for (const [projectId, paths] of projectMap) {
      const key = refKey(snapshotId, projectId);
      for (const path of paths) {
        const entries = this.cache.get(path);
        if (!entries)
          continue;
        for (let i = entries.length - 1;i >= 0; i--) {
          entries[i].refs.delete(key);
          if (entries[i].refs.size === 0) {
            entries.splice(i, 1);
          }
        }
        if (entries.length === 0) {
          this.cache.delete(path);
        }
      }
    }
    this.snapshotProjectPaths.delete(snapshotId);
  }
  trackPath(snapshotId, projectId, path) {
    let projectMap = this.snapshotProjectPaths.get(snapshotId);
    if (!projectMap) {
      projectMap = new Map;
      this.snapshotProjectPaths.set(snapshotId, projectMap);
    }
    let paths = projectMap.get(projectId);
    if (!paths) {
      paths = new Set;
      projectMap.set(projectId, paths);
    }
    paths.add(path);
  }
  clear() {
    this.cache.clear();
    this.snapshotProjectPaths.clear();
  }
  get size() {
    return this.cache.size;
  }
  has(path) {
    return this.cache.has(path);
  }
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/fs.js
var fsCallbackNames = ["readFile", "fileExists", "directoryExists", "getAccessibleEntries", "realpath"];

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/lib/getExePath.js
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
function getExePath() {
  const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
  const normalizedDirname = __dirname2.replace(/\\/g, "/");
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname2, "..", "package.json"), "utf8"));
  const pkgName = pkg.name;
  const baseName = pkgName.startsWith("@") ? pkgName.split("/")[1] : pkgName;
  const expectedBinName = baseName === "typescript" ? "tsc" : "tsgo";
  const binNames = pkg.bin && typeof pkg.bin === "object" ? Object.keys(pkg.bin) : [];
  if (binNames.length !== 1 || binNames[0] !== expectedBinName) {
    throw new Error(`Expected ${pkgName} to declare exactly one bin entry named ${expectedBinName}.`);
  }
  let binName = expectedBinName;
  let exeDir;
  const expectedPackage = baseName + "-" + process.platform + "-" + process.arch;
  if (normalizedDirname.endsWith("/_packages/" + baseName + "/lib")) {
    exeDir = path.resolve(__dirname2, "..", "..", "..", "built", "local");
    binName = "tsgo";
  } else if (normalizedDirname.endsWith("/built/npm/" + baseName + "/lib")) {
    exeDir = path.resolve(__dirname2, "..", "..", expectedPackage, "lib");
  } else {
    const platformPackageName = "@typescript/" + expectedPackage;
    try {
      if (typeof import.meta.resolve === "undefined") {
        const require2 = module.createRequire(import.meta.url);
        const packageJson = require2.resolve(platformPackageName + "/package.json");
        exeDir = path.join(path.dirname(packageJson), "lib");
      } else {
        const packageJson = import.meta.resolve(platformPackageName + "/package.json");
        const packageJsonPath = fileURLToPath(packageJson);
        exeDir = path.join(path.dirname(packageJsonPath), "lib");
      }
    } catch (e) {
      throw new Error("Unable to resolve " + platformPackageName + ". Either your platform is unsupported, or you are missing the package on disk.");
    }
  }
  let exe = path.join(exeDir, binName);
  if (process.platform === "win32") {
    exe += ".exe";
    if (exe.length >= 248) {
      exe = "\\\\?\\" + exe;
    }
  }
  if (!fs.existsSync(exe)) {
    throw new Error("Executable not found: " + exe);
  }
  return exe;
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/options.js
function isSpawnOptions(options) {
  return !("pipe" in options);
}
function resolveExePath(options) {
  return options.tsserverPath ?? getExePath();
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/syncChannel.js
import { spawn } from "node:child_process";
import { closeSync, openSync, readSync, writeSync } from "node:fs";
var MSG_REQUEST = 1;
var MSG_CALL_RESPONSE = 2;
var MSG_CALL_ERROR = 3;
var MSG_RESPONSE = 4;
var MSG_ERROR = 5;
var MSG_CALL = 6;
var sleepBuf = new Int32Array(new SharedArrayBuffer(4));
var EMPTY_BUF = Buffer.alloc(0);
var liveChildren = new Set;
process.on("exit", () => {
  for (const child of liveChildren) {
    try {
      child.kill();
    } catch {}
  }
  liveChildren.clear();
});

class SyncRpcChannel {
  child;
  readFd;
  writeFd;
  pipeFd;
  callbacks = new Map;
  methodBufCache = new Map;
  collectTiming;
  lastBytesSent = 0;
  lastBytesReceived = 0;
  _msgType = 0;
  _msgName = EMPTY_BUF;
  _msgPayload = EMPTY_BUF;
  headerBuf = Buffer.allocUnsafe(4);
  readBuf = Buffer.allocUnsafe(65536);
  readBufPos = 0;
  readBufLen = 0;
  writeBuf = Buffer.allocUnsafe(65536);
  constructor(exe, args, collectTiming = false) {
    this.collectTiming = collectTiming;
    const isWindows = process.platform === "win32";
    if (isWindows) {
      const pipePath = `\\\\.\\pipe\\tsgo-sync-${process.pid}-${Date.now()}`;
      this.child = spawn(exe, [...args, "--pipe", pipePath], {
        stdio: ["ignore", "ignore", "inherit"]
      });
      let fd;
      for (let i = 0;i < 500; i++) {
        try {
          fd = openSync(pipePath, "r+");
          break;
        } catch {
          if (this.child.exitCode !== null) {
            throw new Error(`Child process exited with code ${this.child.exitCode} before pipe was ready`);
          }
          Atomics.wait(sleepBuf, 0, 0, 10);
        }
      }
      if (fd === undefined) {
        this.child.kill();
        throw new Error("SyncRpcChannel: timed out connecting to named pipe");
      }
      this.readFd = fd;
      this.writeFd = fd;
      this.pipeFd = fd;
    } else {
      this.child = spawn(exe, args, {
        stdio: ["pipe", "pipe", "inherit"]
      });
      const stdout = this.child.stdout;
      const stdin = this.child.stdin;
      this.readFd = stdout._handle.fd;
      this.writeFd = stdin._handle.fd;
      if (typeof this.readFd !== "number" || this.readFd < 0 || typeof this.writeFd !== "number" || this.writeFd < 0) {
        stdout.destroy();
        stdin.destroy();
        this.child.kill();
        throw new Error("SyncRpcChannel: could not obtain pipe file descriptors.");
      }
      stdout._handle.setBlocking?.(true);
      stdin._handle.setBlocking?.(true);
      stdout.pause();
      stdout.unref();
      stdin.unref();
    }
    liveChildren.add(this.child);
    this.child.unref();
  }
  requestSync(method, payload) {
    this.ensureOpen();
    const result = this.requestBytesSync(method, payload);
    return result.toString("utf-8");
  }
  requestBinarySync(method, payload) {
    this.ensureOpen();
    return this.requestBytesSync(method, payload);
  }
  registerCallback(name, callback) {
    this.callbacks.set(name, callback);
  }
  close() {
    try {
      liveChildren.delete(this.child);
      if (this.pipeFd !== undefined) {
        closeSync(this.pipeFd);
        this.pipeFd = undefined;
      }
      this.child.stdout?.destroy();
      this.child.stdin?.destroy();
      this.child.kill();
      this.readFd = -1;
      this.writeFd = -1;
    } catch {}
  }
  ensureOpen() {
    if (this.readFd < 0) {
      throw new Error("SyncRpcChannel is closed");
    }
  }
  getMethodBuf(method) {
    let buf = this.methodBufCache.get(method);
    if (buf === undefined) {
      buf = Buffer.from(method, "utf-8");
      this.methodBufCache.set(method, buf);
    }
    return buf;
  }
  requestBytesSync(method, payload) {
    const methodBuf = this.getMethodBuf(method);
    if (this.collectTiming) {
      this.lastBytesSent = typeof payload === "string" ? Buffer.byteLength(payload, "utf-8") : payload.length;
      this.lastBytesReceived = 0;
    }
    this.writeTuple(MSG_REQUEST, methodBuf, payload);
    for (;; ) {
      this.readTuple();
      switch (this._msgType) {
        case MSG_RESPONSE: {
          if (!methodBuf.equals(this._msgName)) {
            throw new Error(`name mismatch for response: expected \`${method}\`, got \`${this._msgName.toString("utf-8")}\``);
          }
          if (this.collectTiming) {
            this.lastBytesReceived = this._msgPayload.length;
          }
          return this._msgPayload;
        }
        case MSG_ERROR: {
          if (methodBuf.equals(this._msgName)) {
            throw new Error(this._msgPayload.toString("utf-8"));
          }
          throw new Error(`name mismatch for response: expected \`${method}\`, got \`${this._msgName.toString("utf-8")}\``);
        }
        case MSG_CALL: {
          this.handleCall(this._msgName.toString("utf-8"), this._msgPayload);
          break;
        }
        default:
          throw new Error(`Invalid message type from child: ${this._msgType}`);
      }
    }
  }
  handleCall(name, payload) {
    const cb = this.callbacks.get(name);
    if (!cb) {
      const errMsg = `unknown callback: \`${name}\`. Please make sure to register it on the JavaScript side before invoking it.`;
      this.writeTuple(MSG_CALL_ERROR, Buffer.from(name, "utf-8"), Buffer.from(errMsg, "utf-8"));
      throw new Error(`no callback named \`${name}\` found`);
    }
    try {
      const result = cb(name, payload.toString("utf-8"));
      this.writeTuple(MSG_CALL_RESPONSE, Buffer.from(name, "utf-8"), Buffer.from(result, "utf-8"));
    } catch (e) {
      const errMsg = String(e instanceof Error ? e.message : e).trim();
      this.writeTuple(MSG_CALL_ERROR, Buffer.from(name, "utf-8"), Buffer.from(errMsg, "utf-8"));
      throw new Error(`Error calling callback \`${name}\`: ${errMsg}`);
    }
  }
  writeTuple(type, name, payload) {
    const nameLen = name.length;
    const payloadIsString = typeof payload === "string";
    const payloadLen = payloadIsString ? Buffer.byteLength(payload, "utf-8") : payload.length;
    const nameHdrSize = binHeaderSize(nameLen);
    const payloadHdrSize = binHeaderSize(payloadLen);
    const headerSize = 2 + nameHdrSize + nameLen + payloadHdrSize;
    const totalSize = headerSize + payloadLen;
    if (totalSize <= this.writeBuf.length) {
      let off = 0;
      this.writeBuf[off++] = MSGPACK_FIXARRAY3;
      this.writeBuf[off++] = type;
      off = writeBinHeader(this.writeBuf, off, nameLen);
      name.copy(this.writeBuf, off);
      off += nameLen;
      off = writeBinHeader(this.writeBuf, off, payloadLen);
      if (payloadLen > 0) {
        if (payloadIsString) {
          this.writeBuf.write(payload, off, payloadLen, "utf-8");
        } else if (payload instanceof Buffer) {
          payload.copy(this.writeBuf, off);
        } else {
          this.writeBuf.set(payload, off);
        }
      }
      this.writeAllBuf(this.writeBuf, totalSize);
    } else {
      let off = 0;
      this.writeBuf[off++] = MSGPACK_FIXARRAY3;
      this.writeBuf[off++] = type;
      off = writeBinHeader(this.writeBuf, off, nameLen);
      name.copy(this.writeBuf, off);
      off += nameLen;
      off = writeBinHeader(this.writeBuf, off, payloadLen);
      this.writeAllBuf(this.writeBuf, off);
      if (payloadLen > 0) {
        if (payloadIsString) {
          this.writeAllBuf(Buffer.from(payload, "utf-8"));
        } else {
          this.writeAllBuf(payload);
        }
      }
    }
  }
  readTuple() {
    const marker = this.readByte();
    if (marker !== MSGPACK_FIXARRAY3) {
      throw new Error(`Expected fixed 3-element array (0x93), received: 0x${marker.toString(16)}`);
    }
    const tb = this.readByte();
    if (tb <= 127) {
      this._msgType = tb;
    } else if (tb === MSGPACK_UINT8) {
      this._msgType = this.readByte();
    } else {
      throw new Error(`Expected positive fixint or uint8 marker, received: 0x${tb.toString(16)}`);
    }
    this._msgName = this.readBin();
    this._msgPayload = this.readBin();
  }
  readBin() {
    const marker = this.readByte();
    let size;
    switch (marker) {
      case MSGPACK_BIN8:
        size = this.readByte();
        break;
      case MSGPACK_BIN16:
        this.readExactInto(this.headerBuf, 2);
        size = this.headerBuf[0] << 8 | this.headerBuf[1];
        break;
      case MSGPACK_BIN32:
        this.readExactInto(this.headerBuf, 4);
        size = this.headerBuf.readUInt32BE(0);
        break;
      default:
        throw new Error(`Expected binary data (0xc4-0xc6), received: 0x${marker.toString(16)}`);
    }
    if (size === 0)
      return EMPTY_BUF;
    return this.readExact(size);
  }
  eofError() {
    const code = this.child.exitCode;
    const signal = this.child.signalCode;
    const detail = signal ? `killed by signal ${signal}` : code !== null ? `exited with code ${code}` : "unknown reason";
    return new Error(`Unexpected EOF while reading from child process (${detail})`);
  }
  readByte() {
    if (this.readBufPos >= this.readBufLen) {
      this.fillReadBuffer();
    }
    return this.readBuf[this.readBufPos++];
  }
  readExact(length) {
    const buf = Buffer.allocUnsafeSlow(length);
    this.readExactInto(buf, length);
    return buf;
  }
  fillReadBuffer() {
    this.readBufPos = 0;
    this.readBufLen = 0;
    for (;; ) {
      try {
        const n = readSync(this.readFd, this.readBuf, 0, this.readBuf.length, null);
        if (n === 0) {
          throw this.eofError();
        }
        this.readBufLen = n;
        return;
      } catch (e) {
        if (e instanceof Error && "code" in e && (e.code === "EAGAIN" || e.code === "EWOULDBLOCK")) {
          Atomics.wait(sleepBuf, 0, 0, 1);
          continue;
        }
        throw e;
      }
    }
  }
  readExactInto(buffer, length) {
    let pos = 0;
    while (pos < length) {
      const avail = this.readBufLen - this.readBufPos;
      if (avail > 0) {
        const toCopy = Math.min(avail, length - pos);
        this.readBuf.copy(buffer, pos, this.readBufPos, this.readBufPos + toCopy);
        this.readBufPos += toCopy;
        pos += toCopy;
      } else if (length - pos >= this.readBuf.length) {
        try {
          const n = readSync(this.readFd, buffer, pos, length - pos, null);
          if (n === 0) {
            throw this.eofError();
          }
          pos += n;
        } catch (e) {
          if (e instanceof Error && "code" in e && (e.code === "EAGAIN" || e.code === "EWOULDBLOCK")) {
            Atomics.wait(sleepBuf, 0, 0, 1);
            continue;
          }
          throw e;
        }
      } else {
        this.fillReadBuffer();
      }
    }
  }
  writeAllBuf(data, length) {
    const total = length ?? data.length;
    let pos = 0;
    while (pos < total) {
      try {
        const n = writeSync(this.writeFd, data, pos, total - pos);
        pos += n;
      } catch (e) {
        if (e instanceof Error && "code" in e && (e.code === "EAGAIN" || e.code === "EWOULDBLOCK")) {
          Atomics.wait(sleepBuf, 0, 0, 1);
          continue;
        }
        throw e;
      }
    }
  }
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/timing.js
var RECENT_REQUEST_CAPACITY = 5;
function emptyAccumulators() {
  return {
    requestCount: 0,
    roundTripMs: 0,
    bytesSent: 0,
    bytesReceived: 0,
    serverTimeMs: 0,
    transportOverheadMs: 0,
    nodesMaterialized: 0,
    sourceFilesFetched: 0,
    nodesFetched: 0
  };
}
function disabledTimingInfo() {
  return {
    enabled: false,
    totals: emptyAccumulators(),
    recentRequests: []
  };
}
function combineTimingInfo(client, server) {
  if (!client.enabled) {
    return client;
  }
  const serverTimeMs = server.totals.totalProcessingTimeMs;
  const totals = {
    ...client.totals,
    serverTimeMs,
    transportOverheadMs: Math.max(0, client.totals.roundTripMs - serverTimeMs)
  };
  const recentRequests = client.recentRequests.map((r) => ({ ...r }));
  const serverRecent = server.recentRequests;
  const pairs = Math.min(recentRequests.length, serverRecent.length);
  for (let i = 1;i <= pairs; i++) {
    const c = recentRequests[recentRequests.length - i];
    const s = serverRecent[serverRecent.length - i];
    if (c.method === s.method) {
      c.serverTimeMs = s.processingTimeMs;
      c.transportOverheadMs = Math.max(0, c.roundTripMs - s.processingTimeMs);
    }
  }
  return {
    enabled: true,
    totals,
    recentRequests
  };
}

class TimingCollector {
  totals = emptyAccumulators();
  ring = [];
  head = 0;
  record(sample) {
    this.totals.requestCount++;
    this.totals.roundTripMs += sample.roundTripMs;
    this.totals.bytesSent += sample.bytesSent;
    this.totals.bytesReceived += sample.bytesReceived;
    const entry = {
      method: sample.method,
      roundTripMs: sample.roundTripMs,
      bytesSent: sample.bytesSent,
      bytesReceived: sample.bytesReceived,
      timestamp: Date.now()
    };
    if (this.ring.length < RECENT_REQUEST_CAPACITY) {
      this.ring.push(entry);
    } else {
      this.ring[this.head] = entry;
      this.head = (this.head + 1) % RECENT_REQUEST_CAPACITY;
    }
  }
  recordMaterialization() {
    this.totals.nodesMaterialized++;
  }
  recordSourceFileFetched(materializableNodeCount) {
    this.totals.sourceFilesFetched++;
    this.totals.nodesFetched += materializableNodeCount;
  }
  getInfo() {
    const recentRequests = [];
    for (let i = 0;i < this.ring.length; i++) {
      recentRequests.push(this.ring[(this.head + i) % this.ring.length]);
    }
    return {
      enabled: true,
      totals: { ...this.totals },
      recentRequests
    };
  }
  reset() {
    this.totals = emptyAccumulators();
    this.ring = [];
    this.head = 0;
  }
}

// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/sync/client.js
class Client {
  channel;
  encoder = new TextEncoder;
  timing;
  constructor(options) {
    if (!isSpawnOptions(options)) {
      throw new Error("Socket connections are not yet supported in the sync client");
    }
    const cwd = options.cwd ?? process.cwd();
    const args = [
      "--api",
      "--cwd",
      cwd
    ];
    const enabledCallbacks = [];
    if (options.fs) {
      for (const name of fsCallbackNames) {
        if (options.fs[name]) {
          enabledCallbacks.push(name);
        }
      }
    }
    if (enabledCallbacks.length > 0) {
      args.push(`--callbacks=${enabledCallbacks.join(",")}`);
    }
    const collectTiming = options.collectTiming ?? false;
    if (collectTiming) {
      args.push("--timing");
      this.timing = new TimingCollector;
    }
    const channel = new SyncRpcChannel(resolveExePath(options), args, collectTiming);
    this.channel = channel;
    if (options.fs) {
      for (const name of enabledCallbacks) {
        const callback = options.fs[name];
        channel.registerCallback(name, (_, arg) => {
          const result = callback(JSON.parse(arg));
          if (name === "readFile") {
            if (result === undefined)
              return "";
            return JSON.stringify({ content: result });
          }
          return JSON.stringify(result) ?? "";
        });
      }
    }
  }
  apiRequest(method, params) {
    const encodedPayload = JSON.stringify(params);
    const start = performance.now();
    const result = this.channel.requestSync(method, encodedPayload);
    this.recordTiming(method, start);
    if (result.length) {
      return JSON.parse(result);
    }
    return;
  }
  apiRequestBinary(method, params) {
    const start = performance.now();
    const result = this.channel.requestBinarySync(method, this.encoder.encode(JSON.stringify(params)));
    this.recordTiming(method, start);
    if (result.length === 0)
      return;
    return result;
  }
  echo(payload) {
    return this.channel.requestSync("echo", payload);
  }
  echoBinary(payload) {
    return this.channel.requestBinarySync("echo", payload);
  }
  getTimingInfo() {
    if (!this.timing) {
      return disabledTimingInfo();
    }
    const local = this.timing.getInfo();
    const result = this.channel.requestSync("getServerTiming", "");
    return combineTimingInfo(local, JSON.parse(result));
  }
  resetTimingInfo() {
    if (!this.timing)
      return;
    this.timing.reset();
    this.channel.requestSync("resetServerTiming", "");
  }
  getTimingCollector() {
    return this.timing;
  }
  recordTiming(method, start) {
    if (!this.timing)
      return;
    this.timing.record({
      method,
      roundTripMs: performance.now() - start,
      bytesSent: this.channel.lastBytesSent,
      bytesReceived: this.channel.lastBytesReceived
    });
  }
  close() {
    this.channel.close();
  }
}
// ../../../../../node_modules/.bun/typescript@7.0.2/node_modules/typescript/dist/api/sync/api.js
class API {
  client;
  sourceFileCache;
  toPath;
  initialized = false;
  activeSnapshots = new Set;
  latestSnapshot;
  internal;
  constructor(options = {}) {
    this.client = new Client(options);
    this.sourceFileCache = new SourceFileCache;
    this.internal = new InternalAPI(this.client, () => this.ensureInitialized());
  }
  static fromLSPConnection(options) {
    const api = new API(options);
    api.ensureInitialized();
    return api;
  }
  ensureInitialized() {
    if (!this.initialized) {
      const response = this.client.apiRequest("initialize", null);
      const getCanonicalFileName = createGetCanonicalFileName(response.useCaseSensitiveFileNames);
      const currentDirectory = response.currentDirectory;
      this.toPath = (fileName) => toPath(fileName, currentDirectory, getCanonicalFileName);
      this.initialized = true;
    }
  }
  parseConfigFile(file) {
    this.ensureInitialized();
    return this.client.apiRequest("parseConfigFile", { file });
  }
  updateSnapshot(params) {
    this.ensureInitialized();
    const requestParams = toUpdateSnapshotRequest(params);
    const data = this.client.apiRequest("updateSnapshot", requestParams);
    if (this.latestSnapshot) {
      this.sourceFileCache.retainForSnapshot(data.snapshot, this.latestSnapshot.id, data.changes);
      if (this.latestSnapshot.isDisposed()) {
        this.sourceFileCache.releaseSnapshot(this.latestSnapshot.id);
      }
    }
    const snapshot = new Snapshot(data, this.client, this.sourceFileCache, this.toPath, () => {
      this.activeSnapshots.delete(snapshot);
      if (snapshot !== this.latestSnapshot) {
        this.sourceFileCache.releaseSnapshot(snapshot.id);
      }
    });
    this.latestSnapshot = snapshot;
    this.activeSnapshots.add(snapshot);
    return snapshot;
  }
  close() {
    for (const snapshot of [...this.activeSnapshots]) {
      snapshot.dispose();
    }
    if (this.latestSnapshot) {
      this.sourceFileCache.releaseSnapshot(this.latestSnapshot.id);
      this.latestSnapshot = undefined;
    }
    this.client.close();
    this.sourceFileCache.clear();
  }
  clearSourceFileCache() {
    this.sourceFileCache.clear();
  }
  getTimingInfo() {
    return this.client.getTimingInfo();
  }
  resetTimingInfo() {
    return this.client.resetTimingInfo();
  }
}

class InternalAPI {
  client;
  ensureInitialized;
  constructor(client, ensureInitialized) {
    this.client = client;
    this.ensureInitialized = ensureInitialized;
  }
  startCPUProfile(dir) {
    this.ensureInitialized();
    this.client.apiRequest("startCPUProfile", { dir });
  }
  stopCPUProfile() {
    this.ensureInitialized();
    const result = this.client.apiRequest("stopCPUProfile", null);
    return result.file;
  }
  saveHeapProfile(dir) {
    this.ensureInitialized();
    const result = this.client.apiRequest("saveHeapProfile", { dir });
    return result.file;
  }
}

class Snapshot {
  id;
  projectMap;
  toPath;
  client;
  disposed = false;
  onDispose;
  snapshotRegistry;
  constructor(data, client, sourceFileCache, toPath, onDispose) {
    this.id = data.snapshot;
    this.client = client;
    this.toPath = toPath;
    this.onDispose = onDispose;
    this.projectMap = new Map;
    this.snapshotRegistry = new SnapshotObjectRegistry(client, this.id, (projectId) => this.projectMap.get(projectId));
    for (const projData of data.projects) {
      const project = new Project(projData, this.id, client, sourceFileCache, toPath, this.snapshotRegistry);
      this.projectMap.set(toPath(projData.configFileName), project);
    }
  }
  getProjects() {
    this.ensureNotDisposed();
    return [...this.projectMap.values()];
  }
  getProject(configFileName) {
    this.ensureNotDisposed();
    return this.projectMap.get(this.toPath(configFileName));
  }
  getDefaultProjectForFile(file) {
    this.ensureNotDisposed();
    const data = this.client.apiRequest("getDefaultProjectForFile", {
      snapshot: this.id,
      file
    });
    if (!data)
      return;
    return this.projectMap.get(this.toPath(data.configFileName));
  }
  [globalThis.Symbol.dispose]() {
    this.dispose();
  }
  dispose() {
    if (this.disposed)
      return;
    this.disposed = true;
    for (const project of this.projectMap.values()) {
      project.dispose();
    }
    this.projectMap.clear();
    this.snapshotRegistry.clear();
    this.onDispose();
    this.client.apiRequest("release", { snapshot: this.id });
  }
  isDisposed() {
    return this.disposed;
  }
  ensureNotDisposed() {
    if (this.disposed) {
      throw new Error("Snapshot is disposed");
    }
  }
}

class SnapshotObjectRegistry {
  symbols = new Map;
  client;
  snapshotId;
  resolveProject;
  constructor(client, snapshotId, resolveProject) {
    this.client = client;
    this.snapshotId = snapshotId;
    this.resolveProject = resolveProject;
  }
  getProject(projectId) {
    return this.resolveProject(projectId);
  }
  getOrCreateSymbol(data) {
    let symbol = this.symbols.get(data.id);
    if (!symbol) {
      symbol = new Symbol2(data, this);
      this.symbols.set(data.id, symbol);
    }
    return symbol;
  }
  getSymbol(id) {
    return this.symbols.get(id);
  }
  clear() {
    this.symbols.clear();
  }
  fetchSymbol(source, method, handle, projectId) {
    if (!handle)
      return;
    const cached = this.getSymbol(handle);
    if (cached)
      return cached;
    const data = this.client.apiRequest(method, {
      snapshot: this.snapshotId,
      project: projectId,
      objectId: source.id
    });
    if (!data)
      throw new Error(`${method} returned null symbol for ${source.constructor.name} ${source.id}`);
    return this.getOrCreateSymbol(data);
  }
  fetchSymbols(source, method, handles, projectId) {
    if (handles) {
      const result = new Array(handles.length);
      let allCached = true;
      for (let i = 0;i < handles.length; i++) {
        const cached = this.getSymbol(handles[i]);
        if (!cached) {
          allCached = false;
          break;
        }
        result[i] = cached;
      }
      if (allCached)
        return result;
    }
    const symbolData = this.client.apiRequest(method, {
      snapshot: this.snapshotId,
      project: projectId,
      objectId: source.id
    });
    if (symbolData == null)
      return [];
    else
      return symbolData.map((data) => this.getOrCreateSymbol(data));
  }
}

class ProjectObjectRegistry {
  client;
  snapshotId;
  project;
  snapshotRegistry;
  types = new Map;
  signatures = new Map;
  constructor(client, snapshotId, project, snapshotRegistry) {
    this.client = client;
    this.snapshotId = snapshotId;
    this.project = project;
    this.snapshotRegistry = snapshotRegistry;
  }
  getOrCreateSymbol(data) {
    return this.snapshotRegistry.getOrCreateSymbol(data);
  }
  getSymbol(id) {
    return this.snapshotRegistry.getSymbol(id);
  }
  getOrCreateType(data) {
    let type = this.types.get(data.id);
    if (!type) {
      type = new TypeObject(data, this);
      this.types.set(data.id, type);
    }
    return type;
  }
  getType(id) {
    return this.types.get(id);
  }
  getOrCreateSignature(data) {
    let sig = this.signatures.get(data.id);
    if (!sig) {
      sig = new Signature(data, this.project, this);
      this.signatures.set(data.id, sig);
    }
    return sig;
  }
  getSignature(id) {
    return this.signatures.get(id);
  }
  clear() {
    this.types.clear();
    this.signatures.clear();
  }
  fetchType(source, method, handle) {
    if (handle !== false) {
      if (!handle)
        return;
      const cached = this.getType(handle);
      if (cached)
        return cached;
    }
    const data = this.client.apiRequest(method, {
      snapshot: this.snapshotId,
      project: this.project.id,
      objectId: source.id
    });
    if (!data)
      throw new Error(`${method} returned null type for ${source.constructor.name} ${source.id}`);
    return this.getOrCreateType(data);
  }
  fetchSymbol(source, method, handle) {
    return this.snapshotRegistry.fetchSymbol(source, method, handle, this.project.id);
  }
  fetchSignature(source, method, handle) {
    if (!handle)
      return;
    const cached = this.getSignature(handle);
    if (cached)
      return cached;
    const data = this.client.apiRequest(method, {
      snapshot: this.snapshotId,
      project: this.project.id,
      objectId: source.id
    });
    if (!data)
      throw new Error(`${method} returned null signature for ${source.constructor.name} ${source.id}`);
    return this.getOrCreateSignature(data);
  }
  fetchTypes(source, method, handles) {
    if (handles) {
      const result = new Array(handles.length);
      let allCached = true;
      for (let i = 0;i < handles.length; i++) {
        const cached = this.getType(handles[i]);
        if (!cached) {
          allCached = false;
          break;
        }
        result[i] = cached;
      }
      if (allCached)
        return result;
    }
    const typesData = this.client.apiRequest(method, {
      snapshot: this.snapshotId,
      project: this.project.id,
      objectId: source.id
    });
    if (typesData == null)
      return [];
    else
      return typesData.map((data) => this.getOrCreateType(data));
  }
  fetchSymbols(source, method, handles) {
    return this.snapshotRegistry.fetchSymbols(source, method, handles, this.project.id);
  }
  fetchBaseTypes(source) {
    const typesData = this.client.apiRequest("getBaseTypes", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: source.id
    });
    if (typesData == null)
      return [];
    return typesData.map((data) => this.getOrCreateType(data));
  }
}

class Project {
  id;
  configFileName;
  compilerOptions;
  rootFiles;
  program;
  checker;
  emitter;
  client;
  constructor(data, snapshotId, client, sourceFileCache, toPath, snapshotRegistry) {
    this.id = data.id;
    this.configFileName = data.configFileName;
    this.compilerOptions = data.compilerOptions;
    this.rootFiles = data.rootFiles;
    this.client = client;
    this.program = new Program(snapshotId, this, client, sourceFileCache, toPath);
    const objectRegistry = new ProjectObjectRegistry(client, snapshotId, this, snapshotRegistry);
    this.checker = new Checker(snapshotId, this, client, objectRegistry);
    this.emitter = new Emitter(client);
  }
  dispose() {
    this.checker.dispose();
  }
}

class Program {
  snapshotId;
  project;
  client;
  sourceFileCache;
  toPath;
  decoder = new Wtf8Decoder;
  sourceFileMetadataCache = new Map;
  constructor(snapshotId, project, client, sourceFileCache, toPath) {
    this.snapshotId = snapshotId;
    this.project = project;
    this.client = client;
    this.sourceFileCache = sourceFileCache;
    this.toPath = toPath;
  }
  getCompilerOptions() {
    return this.project.compilerOptions;
  }
  getSourceFile(file) {
    const fileName = resolveFileName(file);
    const path = this.toPath(fileName);
    const retained = this.sourceFileCache.getRetained(path, this.snapshotId, this.project.id);
    if (retained) {
      return retained;
    }
    const binaryData = this.client.apiRequestBinary("getSourceFile", {
      snapshot: this.snapshotId,
      project: this.project.id,
      file
    });
    if (!binaryData) {
      return;
    }
    const view = new DataView(binaryData.buffer, binaryData.byteOffset, binaryData.byteLength);
    const contentHash = readSourceFileHash(view);
    const parseOptionsKey = readParseOptionsKey(view);
    const sourceFile = new RemoteSourceFile(binaryData, this.decoder, this.client.getTimingCollector());
    return this.sourceFileCache.set(path, sourceFile, parseOptionsKey, contentHash, this.snapshotId, this.project.id);
  }
  getSourceFileNames() {
    const data = this.client.apiRequest("getSourceFileNames", {
      snapshot: this.snapshotId,
      project: this.project.id
    });
    return data ?? [];
  }
  getSourceFileMetadata(fileName) {
    return this.getSourceFileMetadataByPath(this.toPath(fileName));
  }
  getSourceFileMetadataByPath(path) {
    let metadata = this.sourceFileMetadataCache.get(path);
    if (metadata === undefined) {
      metadata = this.fetchSourceFileMetadata(path);
      this.sourceFileMetadataCache.set(path, metadata);
    }
    return metadata;
  }
  fetchSourceFileMetadata(path) {
    const data = this.client.apiRequest("getSourceFileMetadata", {
      snapshot: this.snapshotId,
      project: this.project.id,
      file: path
    });
    return data ?? undefined;
  }
  isSourceFileFromExternalLibrary(file) {
    const metadata = this.getSourceFileMetadataByPath(file.path);
    return metadata?.isFromExternalLibrary ?? false;
  }
  isSourceFileDefaultLibrary(file) {
    const metadata = this.getSourceFileMetadataByPath(file.path);
    return metadata?.isDefaultLibrary ?? false;
  }
  getSyntacticDiagnostics(file) {
    const data = this.client.apiRequest("getSyntacticDiagnostics", {
      snapshot: this.snapshotId,
      project: this.project.id,
      ...file !== undefined ? { file } : {}
    });
    return data ?? [];
  }
  getBindDiagnostics(file) {
    const data = this.client.apiRequest("getBindDiagnostics", {
      snapshot: this.snapshotId,
      project: this.project.id,
      ...file !== undefined ? { file } : {}
    });
    return data ?? [];
  }
  getSemanticDiagnostics(file) {
    const data = this.client.apiRequest("getSemanticDiagnostics", {
      snapshot: this.snapshotId,
      project: this.project.id,
      ...file !== undefined ? { file } : {}
    });
    return data ?? [];
  }
  getSuggestionDiagnostics(file) {
    const data = this.client.apiRequest("getSuggestionDiagnostics", {
      snapshot: this.snapshotId,
      project: this.project.id,
      ...file !== undefined ? { file } : {}
    });
    return data ?? [];
  }
  getDeclarationDiagnostics(file) {
    const data = this.client.apiRequest("getDeclarationDiagnostics", {
      snapshot: this.snapshotId,
      project: this.project.id,
      ...file !== undefined ? { file } : {}
    });
    return data ?? [];
  }
  getProgramDiagnostics() {
    const data = this.client.apiRequest("getProgramDiagnostics", {
      snapshot: this.snapshotId,
      project: this.project.id
    });
    return data ?? [];
  }
  getGlobalDiagnostics() {
    const data = this.client.apiRequest("getGlobalDiagnostics", {
      snapshot: this.snapshotId,
      project: this.project.id
    });
    return data ?? [];
  }
  getConfigFileParsingDiagnostics() {
    const data = this.client.apiRequest("getConfigFileParsingDiagnostics", {
      snapshot: this.snapshotId,
      project: this.project.id
    });
    return data ?? [];
  }
}

class Checker {
  snapshotId;
  project;
  client;
  objectRegistry;
  wellKnownSymbols;
  constructor(snapshotId, project, client, objectRegistry) {
    this.snapshotId = snapshotId;
    this.project = project;
    this.client = client;
    this.objectRegistry = objectRegistry;
  }
  dispose() {
    this.objectRegistry.clear();
  }
  getSymbolAtLocation(nodeOrNodes) {
    if (Array.isArray(nodeOrNodes)) {
      const data = this.client.apiRequest("getSymbolsAtLocations", {
        snapshot: this.snapshotId,
        project: this.project.id,
        locations: nodeOrNodes.map((node) => getNodeId(node))
      });
      return data.map((d) => d ? this.objectRegistry.getOrCreateSymbol(d) : undefined);
    }
    const data = this.client.apiRequest("getSymbolAtLocation", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(nodeOrNodes)
    });
    return data ? this.objectRegistry.getOrCreateSymbol(data) : undefined;
  }
  getSymbolAtPosition(file, positionOrPositions) {
    if (typeof positionOrPositions === "number") {
      const data = this.client.apiRequest("getSymbolAtPosition", {
        snapshot: this.snapshotId,
        project: this.project.id,
        file,
        position: positionOrPositions
      });
      return data ? this.objectRegistry.getOrCreateSymbol(data) : undefined;
    }
    const data = this.client.apiRequest("getSymbolsAtPositions", {
      snapshot: this.snapshotId,
      project: this.project.id,
      file,
      positions: positionOrPositions
    });
    return data.map((d) => d ? this.objectRegistry.getOrCreateSymbol(d) : undefined);
  }
  getTypeOfSymbol(symbolOrSymbols) {
    if (Array.isArray(symbolOrSymbols)) {
      const data = this.client.apiRequest("getTypesOfSymbols", {
        snapshot: this.snapshotId,
        project: this.project.id,
        symbols: symbolOrSymbols.map((s) => s.id)
      });
      return data.map((d) => d ? this.objectRegistry.getOrCreateType(d) : undefined);
    }
    const data = this.client.apiRequest("getTypeOfSymbol", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbolOrSymbols.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getDeclaredTypeOfSymbol(symbol) {
    const data = this.client.apiRequest("getDeclaredTypeOfSymbol", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbol.id
    });
    if (!data)
      throw new Error(`getDeclaredTypeOfSymbol returned no type for symbol ${symbol.id}`);
    return this.objectRegistry.getOrCreateType(data);
  }
  getReferencesToSymbolInFile(file, symbol) {
    const data = this.client.apiRequest("getReferencesToSymbolInFile", {
      snapshot: this.snapshotId,
      project: this.project.id,
      file,
      symbol: symbol.id
    });
    return (data ?? []).map((h) => new NodeHandle(h, this.project));
  }
  getReferencedSymbolsForNode(node, position) {
    const data = this.client.apiRequest("getReferencedSymbolsForNode", {
      snapshot: this.snapshotId,
      project: this.project.id,
      node: getNodeId(node),
      position
    });
    return (data ?? []).map((entry) => ({
      definition: new NodeHandle(entry.definition, this.project),
      symbol: entry.symbol ? this.objectRegistry.getOrCreateSymbol(entry.symbol) : undefined,
      references: (entry.references ?? []).map((h) => new NodeHandle(h, this.project))
    }));
  }
  getSignatureUsage(signatureDecl) {
    const data = this.client.apiRequest("getSignatureUsages", {
      snapshot: this.snapshotId,
      project: this.project.id,
      signatureDecl: getNodeId(signatureDecl)
    });
    return (data ?? []).map((entry) => ({
      name: new NodeHandle(entry.name, this.project),
      call: entry.call ? new NodeHandle(entry.call, this.project) : undefined
    }));
  }
  getCompletionsAtPosition(document, position, options) {
    const data = this.client.apiRequest("getCompletionsAtPosition", {
      snapshot: this.snapshotId,
      project: this.project.id,
      file: document,
      position,
      triggerCharacter: options?.triggerCharacter,
      includeSymbol: options?.includeSymbol
    });
    if (!data)
      return;
    return {
      isIncomplete: data.isIncomplete,
      entries: data.entries.map((e) => ({
        ...e,
        symbol: e.symbol ? this.objectRegistry.getOrCreateSymbol(e.symbol) : undefined
      }))
    };
  }
  getTypeAtLocation(nodeOrNodes) {
    if (Array.isArray(nodeOrNodes)) {
      const data = this.client.apiRequest("getTypeAtLocations", {
        snapshot: this.snapshotId,
        project: this.project.id,
        locations: nodeOrNodes.map((node) => getNodeId(node))
      });
      return data.map((d) => d ? this.objectRegistry.getOrCreateType(d) : undefined);
    }
    const data = this.client.apiRequest("getTypeAtLocation", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(nodeOrNodes)
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getSignaturesOfType(type, kind) {
    const data = this.client.apiRequest("getSignaturesOfType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id,
      kind
    });
    return data.map((d) => this.objectRegistry.getOrCreateSignature(d));
  }
  getResolvedSignature(node) {
    const data = this.client.apiRequest("getResolvedSignature", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(node)
    });
    return data ? this.objectRegistry.getOrCreateSignature(data) : undefined;
  }
  getTypeAtPosition(file, positionOrPositions) {
    if (typeof positionOrPositions === "number") {
      const data = this.client.apiRequest("getTypeAtPosition", {
        snapshot: this.snapshotId,
        project: this.project.id,
        file,
        position: positionOrPositions
      });
      return data ? this.objectRegistry.getOrCreateType(data) : undefined;
    }
    const data = this.client.apiRequest("getTypesAtPositions", {
      snapshot: this.snapshotId,
      project: this.project.id,
      file,
      positions: positionOrPositions
    });
    return data.map((d) => d ? this.objectRegistry.getOrCreateType(d) : undefined);
  }
  resolveName(name, meaning, location, excludeGlobals) {
    const isNode = location && "kind" in location;
    const data = this.client.apiRequest("resolveName", {
      snapshot: this.snapshotId,
      project: this.project.id,
      name,
      meaning,
      location: isNode ? getNodeId(location) : undefined,
      file: !isNode && location ? location.document : undefined,
      position: !isNode && location ? location.position : undefined,
      excludeGlobals
    });
    return data ? this.objectRegistry.getOrCreateSymbol(data) : undefined;
  }
  getResolvedSymbol(node) {
    const text = node.text;
    if (!text)
      return;
    return this.resolveName(text, SymbolFlags.Value | SymbolFlags.ExportValue, node);
  }
  getContextualType(node) {
    const data = this.client.apiRequest("getContextualType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(node)
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getBaseTypeOfLiteralType(type) {
    const data = this.client.apiRequest("getBaseTypeOfLiteralType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getNonNullableType(type) {
    const data = this.client.apiRequest("getNonNullableType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getTypeFromTypeNode(node) {
    const data = this.client.apiRequest("getTypeFromTypeNode", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(node)
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getWidenedType(type) {
    const data = this.client.apiRequest("getWidenedType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getParameterType(signature, index) {
    const data = this.client.apiRequest("getParameterType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      signature: signature.id,
      index
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  isArrayLikeType(type) {
    return this.client.apiRequest("isArrayLikeType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
  }
  isTypeAssignableTo(source, target) {
    return this.client.apiRequest("isTypeAssignableTo", {
      snapshot: this.snapshotId,
      project: this.project.id,
      source: source.id,
      target: target.id
    });
  }
  getShorthandAssignmentValueSymbol(node) {
    const data = this.client.apiRequest("getShorthandAssignmentValueSymbol", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(node)
    });
    return data ? this.objectRegistry.getOrCreateSymbol(data) : undefined;
  }
  getTypeOfSymbolAtLocation(symbol, location) {
    const data = this.client.apiRequest("getTypeOfSymbolAtLocation", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbol.id,
      location: getNodeId(location)
    });
    if (!data)
      throw new Error(`getTypeOfSymbolAtLocation returned no type for symbol ${symbol.id}`);
    return this.objectRegistry.getOrCreateType(data);
  }
  getIntrinsicType(method) {
    const data = this.client.apiRequest(method, {
      snapshot: this.snapshotId,
      project: this.project.id
    });
    return this.objectRegistry.getOrCreateType(data);
  }
  getAnyType() {
    return this.getIntrinsicType("getAnyType");
  }
  getStringType() {
    return this.getIntrinsicType("getStringType");
  }
  getNumberType() {
    return this.getIntrinsicType("getNumberType");
  }
  getBooleanType() {
    return this.getIntrinsicType("getBooleanType");
  }
  getVoidType() {
    return this.getIntrinsicType("getVoidType");
  }
  getUndefinedType() {
    return this.getIntrinsicType("getUndefinedType");
  }
  getNullType() {
    return this.getIntrinsicType("getNullType");
  }
  getNeverType() {
    return this.getIntrinsicType("getNeverType");
  }
  getUnknownType() {
    return this.getIntrinsicType("getUnknownType");
  }
  getBigIntType() {
    return this.getIntrinsicType("getBigIntType");
  }
  getESSymbolType() {
    return this.getIntrinsicType("getESSymbolType");
  }
  typeToTypeNode(type, enclosingDeclaration, flags) {
    const binaryData = this.client.apiRequestBinary("typeToTypeNode", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id,
      location: enclosingDeclaration ? getNodeId(enclosingDeclaration) : undefined,
      flags
    });
    if (!binaryData)
      return;
    return decodeNode(binaryData);
  }
  signatureToSignatureDeclaration(signature, kind, enclosingDeclaration, flags) {
    const binaryData = this.client.apiRequestBinary("signatureToSignatureDeclaration", {
      snapshot: this.snapshotId,
      project: this.project.id,
      signature: signature.id,
      kind,
      location: enclosingDeclaration ? getNodeId(enclosingDeclaration) : undefined,
      flags
    });
    if (!binaryData)
      return;
    return decodeNode(binaryData);
  }
  typeToString(type, enclosingDeclaration, flags) {
    return this.client.apiRequest("typeToString", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id,
      location: enclosingDeclaration ? getNodeId(enclosingDeclaration) : undefined,
      flags
    });
  }
  isContextSensitive(node) {
    return this.client.apiRequest("isContextSensitive", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(node)
    });
  }
  isArrayType(type) {
    return this.client.apiRequest("isArrayType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
  }
  isTupleType(type) {
    return this.client.apiRequest("isTupleType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
  }
  getReturnTypeOfSignature(signature) {
    const data = this.client.apiRequest("getReturnTypeOfSignature", {
      snapshot: this.snapshotId,
      project: this.project.id,
      signature: signature.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getRestTypeOfSignature(signature) {
    const data = this.client.apiRequest("getRestTypeOfSignature", {
      snapshot: this.snapshotId,
      project: this.project.id,
      signature: signature.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getTypePredicateOfSignature(signature) {
    const data = this.client.apiRequest("getTypePredicateOfSignature", {
      snapshot: this.snapshotId,
      project: this.project.id,
      signature: signature.id
    });
    if (!data)
      return;
    return {
      kind: data.kind,
      parameterIndex: data.parameterIndex,
      parameterName: data.parameterName,
      type: data.type ? this.objectRegistry.getOrCreateType(data.type) : undefined
    };
  }
  getBaseTypes(type) {
    const data = this.client.apiRequest("getBaseTypes", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? data.map((d) => this.objectRegistry.getOrCreateType(d)) : [];
  }
  getApparentType(type) {
    const data = this.client.apiRequest("getApparentType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getPropertiesOfType(type) {
    const data = this.client.apiRequest("getPropertiesOfType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? data.map((d) => this.objectRegistry.getOrCreateSymbol(d)) : [];
  }
  getIndexInfosOfType(type) {
    const data = this.client.apiRequest("getIndexInfosOfType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    if (!data)
      return [];
    return data.map((d) => ({
      keyType: this.objectRegistry.getOrCreateType(d.keyType),
      valueType: this.objectRegistry.getOrCreateType(d.valueType),
      isReadonly: d.isReadonly ?? false,
      declaration: d.declaration ? new NodeHandle(d.declaration, this.project) : undefined
    }));
  }
  getConstraintOfTypeParameter(type) {
    const data = this.client.apiRequest("getConstraintOfTypeParameter", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getBaseConstraintOfType(type) {
    const data = this.client.apiRequest("getBaseConstraintOfType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? this.objectRegistry.getOrCreateType(data) : undefined;
  }
  getPropertyOfType(type, name) {
    const data = this.client.apiRequest("getPropertyOfType", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id,
      name
    });
    return data ? this.objectRegistry.getOrCreateSymbol(data) : undefined;
  }
  getConstantValue(node) {
    const data = this.client.apiRequest("getConstantValue", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(node)
    });
    return data ?? undefined;
  }
  getSignatureFromDeclaration(node) {
    const data = this.client.apiRequest("getSignatureFromDeclaration", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(node)
    });
    return data ? this.objectRegistry.getOrCreateSignature(data) : undefined;
  }
  getExportSpecifierLocalTargetSymbol(node) {
    const data = this.client.apiRequest("getExportSpecifierLocalTargetSymbol", {
      snapshot: this.snapshotId,
      project: this.project.id,
      location: getNodeId(node)
    });
    return data ? this.objectRegistry.getOrCreateSymbol(data) : undefined;
  }
  getAliasedSymbol(symbol) {
    const data = this.client.apiRequest("getAliasedSymbol", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbol.id
    });
    if (!data)
      throw new Error(`getAliasedSymbol returned no symbol for symbol ${symbol.id}`);
    return this.objectRegistry.getOrCreateSymbol(data);
  }
  getImmediateAliasedSymbol(symbol) {
    const data = this.client.apiRequest("getImmediateAliasedSymbol", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbol.id
    });
    return data ? this.objectRegistry.getOrCreateSymbol(data) : undefined;
  }
  getWellKnownSymbols() {
    return this.wellKnownSymbols ??= this.client.apiRequest("getWellKnownSymbols", {
      snapshot: this.snapshotId,
      project: this.project.id
    });
  }
  isUnknownSymbol(symbol) {
    return symbol.id === this.getWellKnownSymbols().unknown;
  }
  isUndefinedSymbol(symbol) {
    return symbol.id === this.getWellKnownSymbols().undefined;
  }
  isArgumentsSymbol(symbol) {
    return symbol.id === this.getWellKnownSymbols().arguments;
  }
  getExportsOfModule(symbol) {
    const data = this.client.apiRequest("getExportsOfModule", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbol.id
    });
    return data ? data.map((d) => this.objectRegistry.getOrCreateSymbol(d)) : [];
  }
  getMemberInModuleExports(symbol, name) {
    const data = this.client.apiRequest("getMemberInModuleExports", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbol.id,
      name
    });
    return data ? this.objectRegistry.getOrCreateSymbol(data) : undefined;
  }
  getJsDocTagsOfSymbol(symbol) {
    const data = this.client.apiRequest("getJsDocTags", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbol.id
    });
    return data ?? [];
  }
  getDocumentationCommentOfSymbol(symbol) {
    return this.client.apiRequest("getDocumentationComment", {
      snapshot: this.snapshotId,
      project: this.project.id,
      symbol: symbol.id
    });
  }
  getTypeArguments(type) {
    const data = this.client.apiRequest("getTypeArguments", {
      snapshot: this.snapshotId,
      project: this.project.id,
      type: type.id
    });
    return data ? data.map((d) => this.objectRegistry.getOrCreateType(d)) : [];
  }
}

class Emitter {
  client;
  constructor(client) {
    this.client = client;
  }
  printNode(node, options = {}) {
    const encoded = encodeNode(node);
    const base64 = uint8ArrayToBase64(encoded);
    return this.client.apiRequest("printNode", {
      data: base64,
      ...options
    });
  }
}

class NodeHandle {
  canonicalProject;
  index;
  kind;
  path;
  constructor(handle, canonicalProject) {
    const parsed = parseNodeHandle(handle);
    this.index = parsed.index;
    this.kind = parsed.kind;
    this.path = parsed.path;
    this.canonicalProject = canonicalProject;
  }
  resolve(project = this.canonicalProject) {
    const sourceFile = project.program.getSourceFile(this.path);
    if (!sourceFile) {
      return;
    }
    return sourceFile.getOrCreateNodeAtIndex(this.index);
  }
}

class Symbol2 {
  objectRegistry;
  canonicalProject;
  id;
  escapedName;
  name;
  flags;
  checkFlags;
  declarations;
  valueDeclaration;
  parent;
  exportSymbol;
  membersCache;
  exportsCache;
  constructor(data, objectRegistry) {
    this.objectRegistry = objectRegistry;
    this.id = data.id;
    this.escapedName = data.name;
    this.name = unescapeLeadingUnderscores(data.name);
    this.flags = data.flags;
    this.checkFlags = data.checkFlags;
    const canonicalProject = objectRegistry.getProject(data.project);
    if (!canonicalProject) {
      throw new Error(`Symbol ${data.id} references unknown canonical project '${data.project}'`);
    }
    this.canonicalProject = canonicalProject;
    this.declarations = (data.declarations ?? []).map((d) => new NodeHandle(d, canonicalProject));
    this.valueDeclaration = data.valueDeclaration ? new NodeHandle(data.valueDeclaration, canonicalProject) : undefined;
    if (data.parent !== undefined)
      this.parent = data.parent;
    if (data.exportSymbol !== undefined)
      this.exportSymbol = data.exportSymbol;
  }
  getParent() {
    return this.objectRegistry.fetchSymbol(this, "getParentOfSymbol", this.parent, this.canonicalProject.id);
  }
  getMembers() {
    return this.membersCache ??= this.fetchSymbolTable("getMembersOfSymbol");
  }
  getExports() {
    return this.exportsCache ??= this.fetchSymbolTable("getExportsOfSymbol");
  }
  fetchSymbolTable(method) {
    const symbols = this.objectRegistry.fetchSymbols(this, method, undefined, this.canonicalProject.id);
    const table = new Map;
    for (const symbol of symbols) {
      table.set(symbol.escapedName, symbol);
    }
    return table;
  }
  getExportSymbol() {
    if (!this.exportSymbol)
      return this;
    return this.objectRegistry.fetchSymbol(this, "getExportSymbolOfSymbol", this.exportSymbol, this.canonicalProject.id);
  }
  getJsDocTags(checker) {
    return checker.getJsDocTagsOfSymbol(this);
  }
  getDocumentationComment(checker) {
    return checker.getDocumentationCommentOfSymbol(this);
  }
}

class TypeObject {
  objectRegistry;
  id;
  flags;
  objectFlags;
  symbol;
  value;
  intrinsicName;
  isThisType;
  freshType;
  regularType;
  target;
  typeParameters;
  outerTypeParameters;
  localTypeParameters;
  aliasTypeArguments;
  aliasSymbol;
  elementFlags;
  fixedLength;
  readonly;
  texts;
  objectType;
  indexType;
  checkType;
  extendsType;
  baseType;
  substConstraint;
  trueType;
  falseType;
  constructor(data, objectRegistry) {
    this.objectRegistry = objectRegistry;
    this.id = data.id;
    this.flags = data.flags;
    if (data.objectFlags !== undefined)
      this.objectFlags = data.objectFlags;
    if (data.symbol !== undefined)
      this.symbol = data.symbol;
    if (data.value != null) {
      this.value = data.flags & TypeFlags.BigIntLiteral ? BigInt(data.value) : data.value;
    }
    if (data.intrinsicName !== undefined)
      this.intrinsicName = data.intrinsicName;
    if (data.isThisType !== undefined)
      this.isThisType = data.isThisType;
    if (data.freshType !== undefined)
      this.freshType = data.freshType;
    if (data.regularType !== undefined)
      this.regularType = data.regularType;
    if (data.target !== undefined)
      this.target = data.target;
    this.typeParameters = data.typeParameters ?? [];
    this.outerTypeParameters = data.outerTypeParameters ?? [];
    this.localTypeParameters = data.localTypeParameters ?? [];
    this.aliasTypeArguments = data.aliasTypeArguments ?? [];
    if (data.aliasSymbol !== undefined)
      this.aliasSymbol = data.aliasSymbol;
    if (data.elementFlags !== undefined)
      this.elementFlags = data.elementFlags;
    if (data.fixedLength !== undefined)
      this.fixedLength = data.fixedLength;
    if (data.readonly !== undefined)
      this.readonly = data.readonly;
    if (data.texts !== undefined)
      this.texts = data.texts;
    if (data.objectType !== undefined)
      this.objectType = data.objectType;
    if (data.indexType !== undefined)
      this.indexType = data.indexType;
    if (data.checkType !== undefined)
      this.checkType = data.checkType;
    if (data.extendsType !== undefined)
      this.extendsType = data.extendsType;
    if (data.baseType !== undefined)
      this.baseType = data.baseType;
    if (data.substConstraint !== undefined)
      this.substConstraint = data.substConstraint;
    this.trueType = false;
    this.falseType = false;
  }
  getSymbol() {
    return this.objectRegistry.fetchSymbol(this, "getSymbolOfType", this.symbol);
  }
  getAliasSymbol() {
    return this.objectRegistry.fetchSymbol(this, "getAliasSymbolOfType", this.aliasSymbol);
  }
  getTarget() {
    return this.objectRegistry.fetchType(this, "getTargetOfType", this.target);
  }
  getFreshType() {
    return this.objectRegistry.fetchType(this, "getFreshTypeOfType", this.freshType);
  }
  getRegularType() {
    return this.objectRegistry.fetchType(this, "getRegularTypeOfType", this.regularType);
  }
  getTypes() {
    if (!(this.flags & (TypeFlags.UnionOrIntersection | TypeFlags.TemplateLiteral))) {
      return;
    }
    return this.objectRegistry.fetchTypes(this, "getTypesOfType");
  }
  getTypeParameters() {
    return this.objectRegistry.fetchTypes(this, "getTypeParametersOfType", this.typeParameters);
  }
  getOuterTypeParameters() {
    return this.objectRegistry.fetchTypes(this, "getOuterTypeParametersOfType", this.outerTypeParameters);
  }
  getLocalTypeParameters() {
    return this.objectRegistry.fetchTypes(this, "getLocalTypeParametersOfType", this.localTypeParameters);
  }
  getAliasTypeArguments() {
    return this.objectRegistry.fetchTypes(this, "getAliasTypeArgumentsOfType", this.aliasTypeArguments);
  }
  getObjectType() {
    return this.objectRegistry.fetchType(this, "getObjectTypeOfType", this.objectType);
  }
  getIndexType() {
    return this.objectRegistry.fetchType(this, "getIndexTypeOfType", this.indexType);
  }
  getCheckType() {
    return this.objectRegistry.fetchType(this, "getCheckTypeOfType", this.checkType);
  }
  getExtendsType() {
    return this.objectRegistry.fetchType(this, "getExtendsTypeOfType", this.extendsType);
  }
  getBaseType() {
    return this.objectRegistry.fetchType(this, "getBaseTypeOfType", this.baseType);
  }
  getConstraint() {
    return this.objectRegistry.fetchType(this, "getConstraintOfType", this.substConstraint);
  }
  getTrueType() {
    const result = this.objectRegistry.fetchType(this, "getTrueTypeOfConditionalType", this.trueType);
    this.trueType = result.id;
    return result;
  }
  getFalseType() {
    const result = this.objectRegistry.fetchType(this, "getFalseTypeOfConditionalType", this.falseType);
    this.falseType = result.id;
    return result;
  }
  getBaseTypes() {
    if (!this.isClassOrInterface()) {
      return;
    }
    return this.objectRegistry.fetchBaseTypes(this);
  }
  isClassOrInterface() {
    return isClassOrInterfaceType(this);
  }
  isUnionType() {
    return isUnionType(this);
  }
  isIntersectionType() {
    return isIntersectionType(this);
  }
  isObjectType() {
    return isObjectType(this);
  }
  isIntrinsicType() {
    return isIntrinsicType(this);
  }
  isErrorType() {
    return isErrorType(this);
  }
  isLiteralType() {
    return isLiteralType(this);
  }
  isStringLiteralType() {
    return isStringLiteralType(this);
  }
  isNumberLiteralType() {
    return isNumberLiteralType(this);
  }
  isBigIntLiteralType() {
    return isBigIntLiteralType(this);
  }
  isBooleanLiteralType() {
    return isBooleanLiteralType(this);
  }
  isTypeReference() {
    return isTypeReference(this);
  }
  isTupleType() {
    return isTupleType(this);
  }
  isIndexType() {
    return isIndexType(this);
  }
  isIndexedAccessType() {
    return isIndexedAccessType(this);
  }
  isConditionalType() {
    return isConditionalType(this);
  }
  isSubstitutionType() {
    return isSubstitutionType(this);
  }
  isTemplateLiteralType() {
    return isTemplateLiteralType(this);
  }
  isStringMappingType() {
    return isStringMappingType(this);
  }
  isTypeParameter() {
    return isTypeParameter(this);
  }
}
function isUnionType(type) {
  return (type.flags & TypeFlags.Union) !== 0;
}
function isIntersectionType(type) {
  return (type.flags & TypeFlags.Intersection) !== 0;
}
function isObjectType(type) {
  return (type.flags & TypeFlags.Object) !== 0;
}
function isClassOrInterfaceType(type) {
  return isObjectType(type) && (type.objectFlags & ObjectFlags.ClassOrInterface) !== 0;
}
function isIntrinsicType(type) {
  return (type.flags & TypeFlags.Intrinsic) !== 0;
}
function isErrorType(type) {
  return isIntrinsicType(type) && type.intrinsicName === "error";
}
function isLiteralType(type) {
  return (type.flags & TypeFlags.Literal) !== 0;
}
function isStringLiteralType(type) {
  return (type.flags & TypeFlags.StringLiteral) !== 0;
}
function isNumberLiteralType(type) {
  return (type.flags & TypeFlags.NumberLiteral) !== 0;
}
function isBigIntLiteralType(type) {
  return (type.flags & TypeFlags.BigIntLiteral) !== 0;
}
function isBooleanLiteralType(type) {
  return (type.flags & TypeFlags.BooleanLiteral) !== 0;
}
function isTypeReference(type) {
  return isObjectType(type) && (type.objectFlags & ObjectFlags.Reference) !== 0;
}
function isTupleType(type) {
  return isObjectType(type) && (type.objectFlags & ObjectFlags.Tuple) !== 0;
}
function isIndexType(type) {
  return (type.flags & TypeFlags.Index) !== 0;
}
function isIndexedAccessType(type) {
  return (type.flags & TypeFlags.IndexedAccess) !== 0;
}
function isConditionalType(type) {
  return (type.flags & TypeFlags.Conditional) !== 0;
}
function isSubstitutionType(type) {
  return (type.flags & TypeFlags.Substitution) !== 0;
}
function isTemplateLiteralType(type) {
  return (type.flags & TypeFlags.TemplateLiteral) !== 0;
}
function isStringMappingType(type) {
  return (type.flags & TypeFlags.StringMapping) !== 0;
}
function isTypeParameter(type) {
  return (type.flags & TypeFlags.TypeParameter) !== 0;
}

class Signature {
  flags;
  objectRegistry;
  id;
  declaration;
  typeParameters;
  parameters;
  thisParameter;
  target;
  constructor(data, project, objectRegistry) {
    this.id = data.id;
    this.flags = data.flags;
    this.objectRegistry = objectRegistry;
    this.declaration = data.declaration ? new NodeHandle(data.declaration, project) : undefined;
    this.typeParameters = data.typeParameters ?? [];
    this.parameters = data.parameters ?? [];
    this.thisParameter = data.thisParameter;
    this.target = data.target;
  }
  getTypeParameters() {
    return this.objectRegistry.fetchTypes(this, "getTypeParametersOfSignature", this.typeParameters);
  }
  getParameters() {
    return this.objectRegistry.fetchSymbols(this, "getParametersOfSignature", this.parameters);
  }
  getThisParameter() {
    return this.objectRegistry.fetchSymbol(this, "getThisParameterOfSignature", this.thisParameter);
  }
  getTarget() {
    return this.objectRegistry.fetchSignature(this, "getTargetOfSignature", this.target);
  }
  get hasRestParameter() {
    return (this.flags & SignatureFlags.HasRestParameter) !== 0;
  }
  get isConstruct() {
    return (this.flags & SignatureFlags.Construct) !== 0;
  }
  get isAbstract() {
    return (this.flags & SignatureFlags.Abstract) !== 0;
  }
}

// ../../../../omo-engine/code-graph/src/extract.ts
var STATIC_CONFIDENCE = 1;
var UNRESOLVED_CONFIDENCE = 0.5;
var UNKNOWN = "unknown";
var RECORD_ID = /^pk-[0-9a-f]{12}$/;
var MAX_ALIAS_DEPTH = 10;
function isTestPath(path) {
  const normalized = path.replace(/\\/g, "/");
  return /(^|\/)__tests__\//.test(normalized) || /\.test\.[cm]?[tj]sx?$/.test(normalized) || /\.spec\.[cm]?[tj]sx?$/.test(normalized) || /(^|\/)(test|tests)\//.test(normalized);
}
function toPosixPath(value) {
  const slashed = value.replace(/\\/g, "/");
  return /^[a-zA-Z]:\//.test(slashed) ? slashed[0].toLowerCase() + slashed.slice(1) : slashed;
}
function commonDir(paths) {
  const [first, ...rest] = paths;
  if (first === undefined)
    return process.cwd().replace(/\\/g, "/");
  const firstSegments = first.split("/").slice(0, -1);
  let length = firstSegments.length;
  for (const other of rest) {
    const segments = other.split("/").slice(0, -1);
    let shared = 0;
    while (shared < length && shared < segments.length && firstSegments[shared] === segments[shared]) {
      shared += 1;
    }
    length = shared;
  }
  return firstSegments.slice(0, length).join("/") || "/";
}
function defaultTsServerPath() {
  const require2 = createRequire(import.meta.url);
  const tsDir = dirname(require2.resolve("typescript/package.json"));
  const platformRoot = join(tsDir, "..", "@typescript");
  if (existsSync(platformRoot)) {
    const platform = `typescript-${process.platform}-${process.arch}`;
    const names = readdirSync(platformRoot).sort();
    const ordered = [...names.filter((name) => name === platform), ...names.filter((name) => name !== platform)];
    for (const name of ordered) {
      for (const binary of ["tsc.exe", "tsgo", "tsc"]) {
        const candidate = join(platformRoot, name, "lib", binary);
        if (existsSync(candidate))
          return candidate;
      }
    }
  }
  for (const binary of process.platform === "win32" ? ["tsc.exe", "tsc"] : ["tsc"]) {
    const candidate = join(tsDir, "..", ".bin", binary);
    if (existsSync(candidate))
      return candidate;
  }
  throw new Error("code-graph: TypeScript native server binary not found inside typescript@7.0.2; " + "pass IndexOptions.tsserverPath explicitly");
}
function isSymbolLike(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const candidate = value;
  return typeof candidate.name === "string" && typeof candidate.flags === "number" && Array.isArray(candidate.declarations);
}
function followAlias(checker, symbol) {
  let current = symbol;
  for (let depth = 0;depth < MAX_ALIAS_DEPTH; depth += 1) {
    if ((current.flags & SymbolFlags.Alias) === 0)
      return current;
    const next = checker.getAliasedSymbol(current);
    if (!next || next === current)
      return current;
    current = next;
  }
  return current;
}
function ownerClassName(declaration) {
  const parent = declaration.parent;
  if (parent === undefined)
    return;
  if ((isClassDeclaration(parent) || isClassExpression(parent)) && parent.name && isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return;
}
function callableInitializer(decl) {
  if (!isVariableDeclaration(decl) || decl.initializer === undefined)
    return false;
  return isArrowFunction(decl.initializer) || isFunctionExpression(decl.initializer);
}
function symbolIdForDecl(declaration, nameText, fileRel) {
  if (isConstructorDeclaration(declaration)) {
    const owner = ownerClassName(declaration);
    return `fn:${owner ? `${owner}.` : ""}constructor@${fileRel}`;
  }
  if (isMethodDeclaration(declaration)) {
    const owner = ownerClassName(declaration);
    return `fn:${owner ? `${owner}.` : ""}${nameText}@${fileRel}`;
  }
  if (isClassDeclaration(declaration) || isClassExpression(declaration))
    return `class:${nameText}@${fileRel}`;
  if (isInterfaceDeclaration(declaration))
    return `interface:${nameText}@${fileRel}`;
  if (isEnumDeclaration(declaration))
    return `enum:${nameText}@${fileRel}`;
  if (isTypeAliasDeclaration(declaration))
    return `type:${nameText}@${fileRel}`;
  if (isFunctionDeclaration(declaration) || isFunctionExpression(declaration) || isArrowFunction(declaration)) {
    return `fn:${nameText}@${fileRel}`;
  }
  return `const:${nameText}@${fileRel}`;
}
function isCallableDeclKind(kind) {
  return kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.FunctionExpression || kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.MethodDeclaration || kind === SyntaxKind.Constructor || kind === SyntaxKind.ClassDeclaration || kind === SyntaxKind.ClassExpression;
}

class GraphBuilder {
  root;
  files = new Map;
  nodes = new Map;
  edges = new Map;
  callOrdinals = new Map;
  constructor(root) {
    this.root = root;
  }
  snapshot() {
    const nodes = [...this.nodes.values()].sort((left, right) => left.id < right.id ? -1 : 1);
    const edges = [...this.edges.values()].sort((left, right) => left.id < right.id ? -1 : 1);
    return { nodes, edges };
  }
  addEntries(project, entries) {
    const program = project.program;
    const queue = [];
    for (const entry of entries) {
      const key = toPosixPath(entry);
      const sourceFile = program.getSourceFile(entry);
      if (!sourceFile)
        throw new Error(`code-graph: entry is not part of the TypeScript program: ${entry}`);
      if (program.isSourceFileDefaultLibrary(sourceFile)) {
        throw new Error(`code-graph: entry is a TypeScript default library file: ${entry}`);
      }
      queue.push(key);
    }
    while (queue.length > 0) {
      const key = queue.pop();
      if (key === undefined || this.files.has(key))
        continue;
      const sourceFile = program.getSourceFile(key);
      if (!sourceFile)
        continue;
      if (program.isSourceFileDefaultLibrary(sourceFile) || program.isSourceFileFromExternalLibrary(sourceFile)) {
        continue;
      }
      const rel = this.relOf(key);
      const ctx = { key, rel, sourceFile, project, checker: project.checker };
      this.files.set(key, ctx);
      this.nodes.set(`file:${rel}`, { id: `file:${rel}`, kind: "file", file: rel, line: 1, name: rel });
      for (const target of this.staticImportTargets(ctx)) {
        if (!this.files.has(target))
          queue.push(target);
      }
    }
    const ordered = [...this.files.values()].sort((left, right) => left.rel < right.rel ? -1 : 1);
    for (const ctx of ordered) {
      const isTest = isTestPath(ctx.rel);
      if (isTest) {
        const fileNode = this.nodes.get(`file:${ctx.rel}`);
        if (fileNode)
          this.nodes.set(fileNode.id, { ...fileNode, isTest: true });
      }
      this.emitImports(ctx, isTest);
      this.emitExports(ctx);
      this.emitDefinitions(ctx);
      this.emitCalls(ctx);
    }
  }
  addKnowledgeLinks(links) {
    for (const link of links) {
      if (link.from.length === 0 || !RECORD_ID.test(link.recordId))
        continue;
      if (!Number.isFinite(link.confidence) || link.confidence < 0 || link.confidence > 1)
        continue;
      const id = `knowledge:${link.recordId}`;
      const file = toPosixPath(link.sourceFile);
      this.nodes.set(id, { id, kind: "knowledge-link", file, line: 1, target: link.recordId, revision: link.sourceRevision });
      const edgeId = `links:${link.from}:${link.recordId}`;
      this.edges.set(edgeId, {
        id: edgeId,
        kind: "LINKS_KNOWLEDGE",
        from: link.from,
        to: id,
        confidence: link.confidence,
        ref: `${file}:1`
      });
    }
  }
  relOf(key) {
    const rel = key.startsWith(`${this.root}/`) ? key.slice(this.root.length + 1) : key;
    return rel;
  }
  lineOf(ctx, node) {
    return ctx.sourceFile.getLineAndCharacterOfPosition(node.getStart(ctx.sourceFile)).line + 1;
  }
  resolveModuleKey(ctx, specifierNode) {
    const symbol = ctx.checker.getSymbolAtLocation(specifierNode);
    if (!symbol || (symbol.flags & SymbolFlags.Alias) !== 0)
      return;
    const keys = new Set;
    for (const handle of symbol.declarations) {
      const declaration = handle.resolve(ctx.project);
      if (!declaration || !isSourceFile(declaration))
        continue;
      keys.add(toPosixPath(declaration.fileName));
    }
    if (keys.size !== 1)
      return;
    const [key] = keys;
    if (key === undefined)
      return;
    const target = ctx.project.program.getSourceFile(key);
    if (!target)
      return;
    if (ctx.project.program.isSourceFileDefaultLibrary(target))
      return;
    return key;
  }
  staticImportTargets(ctx) {
    const targets = [];
    const visit = (node) => {
      if (isImportDeclaration(node) || isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (specifier && isStringLiteral(specifier)) {
          const key = this.resolveModuleKey(ctx, specifier);
          if (key)
            targets.push(key);
        }
        return;
      }
      node.forEachChild((child) => {
        visit(child);
        return;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return;
    });
    return targets;
  }
  emitImports(ctx, isTest) {
    const visit = (node) => {
      if (isImportDeclaration(node) || isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier;
        if (specifier && isStringLiteral(specifier)) {
          const line = this.lineOf(ctx, specifier);
          const key = this.resolveModuleKey(ctx, specifier);
          const target = key === undefined ? undefined : this.files.get(key);
          if (target) {
            const edgeId = `imports:file:${ctx.rel}:file:${target.rel}:${line}`;
            this.edges.set(edgeId, {
              id: edgeId,
              kind: "IMPORTS",
              from: `file:${ctx.rel}`,
              to: `file:${target.rel}`,
              confidence: STATIC_CONFIDENCE,
              ref: `${ctx.rel}:${line}`
            });
            if (isTest) {
              const testId = `tests:file:${ctx.rel}:file:${target.rel}:${line}`;
              this.edges.set(testId, {
                id: testId,
                kind: "TESTS",
                from: `file:${ctx.rel}`,
                to: `file:${target.rel}`,
                confidence: STATIC_CONFIDENCE,
                ref: `${ctx.rel}:${line}`
              });
            }
          }
        }
        return;
      }
      node.forEachChild((child) => {
        visit(child);
        return;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return;
    });
  }
  emitExports(ctx) {
    if (!ctx.sourceFile.externalModuleIndicator)
      return;
    const moduleSymbol = ctx.checker.getSymbolAtLocation(ctx.sourceFile);
    if (!moduleSymbol)
      return;
    const raw = ctx.checker.getExportsOfModule(moduleSymbol);
    const exported = Array.isArray(raw) ? raw.filter(isSymbolLike) : [];
    const contractLines = this.exportContractLines(ctx);
    for (const exportedSymbol of exported) {
      if ((exportedSymbol.flags & SymbolFlags.ExportStar) !== 0)
        continue;
      if (exportedSymbol.name.startsWith("__"))
        continue;
      const contractId = `export:${exportedSymbol.name}@${ctx.rel}`;
      const origin = followAlias(ctx.checker, exportedSymbol);
      const targets = new Map;
      for (const handle of origin.declarations) {
        const declaration = handle.resolve(ctx.project);
        if (!declaration)
          continue;
        const declFile = toPosixPath(declaration.getSourceFile().fileName);
        const targetCtx = this.files.get(declFile);
        if (!targetCtx)
          continue;
        const nameText = this.declaredName(declaration);
        if (!nameText)
          continue;
        const targetId = symbolIdForDecl(declaration, nameText, targetCtx.rel);
        targets.set(targetId, targetId);
      }
      const line = contractLines.get(exportedSymbol.name) ?? 1;
      if (targets.size === 1) {
        const [targetId] = targets.keys();
        if (targetId === undefined)
          continue;
        this.nodes.set(contractId, {
          id: contractId,
          kind: "export-contract",
          file: ctx.rel,
          line,
          name: exportedSymbol.name,
          target: targetId
        });
        const edgeId = `exports:file:${ctx.rel}:${contractId}:${targetId}`;
        this.edges.set(edgeId, {
          id: edgeId,
          kind: "EXPORTS",
          from: `file:${ctx.rel}`,
          to: contractId,
          confidence: STATIC_CONFIDENCE,
          ref: `${ctx.rel}:${line}`
        });
      } else {
        this.nodes.set(contractId, {
          id: contractId,
          kind: "export-contract",
          file: ctx.rel,
          line,
          name: exportedSymbol.name
        });
        const candidates = targets.size > 0 ? [...targets.keys()] : [UNKNOWN];
        for (const candidate of candidates) {
          const edgeId = `exports:file:${ctx.rel}:${contractId}:${candidate}`;
          this.edges.set(edgeId, {
            id: edgeId,
            kind: "EXPORTS",
            from: `file:${ctx.rel}`,
            to: candidate === UNKNOWN ? UNKNOWN : contractId,
            confidence: UNRESOLVED_CONFIDENCE,
            ref: `${ctx.rel}:${line}`,
            uncertain: true
          });
        }
      }
    }
  }
  exportContractLines(ctx) {
    const lines = new Map;
    const visit = (node) => {
      if (isExportDeclaration(node)) {
        const clause = node.exportClause;
        if (clause && clause.kind === SyntaxKind.NamedExports) {
          clause.elements.forEach((element) => {
            const exported = element.propertyName ?? element.name;
            const text = exported.text;
            if (!lines.has(text))
              lines.set(text, this.lineOf(ctx, element));
          });
        }
        if (node.moduleSpecifier === undefined)
          return;
        return;
      }
      node.forEachChild((child) => {
        visit(child);
        return;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return;
    });
    return lines;
  }
  declaredName(declaration) {
    if (isConstructorDeclaration(declaration))
      return "constructor";
    if (isFunctionDeclaration(declaration) || isFunctionExpression(declaration) || isClassDeclaration(declaration) || isClassExpression(declaration) || isInterfaceDeclaration(declaration) || isEnumDeclaration(declaration) || isTypeAliasDeclaration(declaration) || isMethodDeclaration(declaration)) {
      const name = declaration.name;
      return name && isIdentifier(name) ? name.text : undefined;
    }
    if (isVariableDeclaration(declaration)) {
      return isIdentifier(declaration.name) ? declaration.name.text : undefined;
    }
    return;
  }
  emitDefinitions(ctx) {
    const define = (declaration, nameNode) => {
      if (!isIdentifier(nameNode))
        return;
      const symbol = ctx.checker.getSymbolAtLocation(nameNode);
      if (!symbol)
        return;
      const id = symbolIdForDecl(declaration, nameNode.text, ctx.rel);
      const line = this.lineOf(ctx, nameNode);
      this.nodes.set(id, { id, kind: "symbol", file: ctx.rel, line, name: symbol.name });
      const edgeId = `defines:file:${ctx.rel}:${id}`;
      this.edges.set(edgeId, {
        id: edgeId,
        kind: "DEFINES",
        from: `file:${ctx.rel}`,
        to: id,
        confidence: STATIC_CONFIDENCE,
        ref: `${ctx.rel}:${line}`
      });
    };
    const visit = (node) => {
      if (isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (isVariableDeclaration(declaration))
            define(declaration, declaration.name);
        }
      } else if (isFunctionDeclaration(node) || isFunctionExpression(node) || isClassDeclaration(node) || isClassExpression(node) || isInterfaceDeclaration(node) || isEnumDeclaration(node) || isTypeAliasDeclaration(node) || isMethodDeclaration(node)) {
        if (node.name)
          define(node, node.name);
      }
      node.forEachChild((child) => {
        visit(child);
        return;
      });
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return;
    });
  }
  emitCalls(ctx) {
    const callers = [`file:${ctx.rel}`];
    const visit = (node) => {
      const boundary = this.boundaryId(ctx, node);
      if (boundary)
        callers.push(boundary);
      const caller = callers[callers.length - 1] ?? `file:${ctx.rel}`;
      if (isCallExpression(node))
        this.recordCall(ctx, node, node.expression, caller);
      else if (isNewExpression(node))
        this.recordCall(ctx, node, node.expression, caller);
      else if (isJsxOpeningElement(node) || isJsxSelfClosingElement(node)) {
        this.recordCall(ctx, node, node.tagName, caller);
      }
      node.forEachChild((child) => {
        visit(child);
        return;
      });
      if (boundary)
        callers.pop();
    };
    ctx.sourceFile.forEachChild((child) => {
      visit(child);
      return;
    });
  }
  boundaryId(ctx, node) {
    if (isConstructorDeclaration(node)) {
      const owner = ownerClassName(node);
      return owner ? `class:${owner}@${ctx.rel}` : `file:${ctx.rel}`;
    }
    if (isFunctionDeclaration(node) || isFunctionExpression(node) || isMethodDeclaration(node) || isVariableDeclaration(node)) {
      if (!isVariableDeclaration(node) && node.name === undefined)
        return;
      const nameNode = isVariableDeclaration(node) ? node.name : node.name;
      if (!nameNode || !isIdentifier(nameNode))
        return;
      if (isVariableDeclaration(node) && !callableInitializer(node))
        return;
      if (isVariableDeclaration(node))
        return `const:${nameNode.text}@${ctx.rel}`;
      const symbol = ctx.checker.getSymbolAtLocation(nameNode);
      if (!symbol)
        return;
      return symbolIdForDecl(node, nameNode.text, ctx.rel);
    }
    return;
  }
  classifyCall(ctx, call, callee) {
    if (callee.kind === SyntaxKind.ImportKeyword)
      return { kind: "unresolved" };
    if (isIdentifier(callee) && (callee.text === "eval" || callee.text === "require")) {
      return { kind: "unresolved" };
    }
    if (isNewExpression(call) && isIdentifier(callee) && callee.text === "Function") {
      return { kind: "unresolved" };
    }
    if (isElementAccessExpression(callee))
      return { kind: "unresolved" };
    if (isFunctionExpression(callee) || isArrowFunction(callee))
      return { kind: "skip" };
    const symbol = ctx.checker.getSymbolAtLocation(callee);
    if (!symbol)
      return { kind: "unresolved" };
    const final = followAlias(ctx.checker, symbol);
    const inGraph = [];
    for (const handle of final.declarations) {
      const declaration = handle.resolve(ctx.project);
      if (!declaration)
        continue;
      const declFile = toPosixPath(declaration.getSourceFile().fileName);
      if (this.files.has(declFile))
        inGraph.push(declaration);
    }
    if (inGraph.length === 0)
      return { kind: "skip" };
    const callable = inGraph.filter((declaration) => isCallableDeclKind(declaration.kind) || callableInitializer(declaration));
    if (callable.length !== inGraph.length)
      return { kind: "unresolved" };
    const targets = new Set;
    for (const declaration of callable) {
      const nameText = this.declaredName(declaration);
      if (!nameText)
        return { kind: "unresolved" };
      const declFile = toPosixPath(declaration.getSourceFile().fileName);
      const targetCtx = this.files.get(declFile);
      if (!targetCtx)
        return { kind: "unresolved" };
      targets.add(symbolIdForDecl(declaration, nameText, targetCtx.rel));
    }
    if (targets.size !== 1)
      return { kind: "unresolved" };
    const [targetId] = targets;
    if (targetId === undefined)
      return { kind: "unresolved" };
    return { kind: "static", targetId };
  }
  recordCall(ctx, call, callee, callerId) {
    const outcome = this.classifyCall(ctx, call, callee);
    if (outcome.kind === "skip")
      return;
    const line = this.lineOf(ctx, call);
    const ordinal = this.callOrdinals.get(ctx.key) ?? 0;
    this.callOrdinals.set(ctx.key, ordinal + 1);
    const callSiteId = `call:${ctx.rel}:${line}:${ordinal}`;
    const calleeText = callee.getText().slice(0, 80);
    this.nodes.set(callSiteId, { id: callSiteId, kind: "call-site", file: ctx.rel, line, name: calleeText });
    if (outcome.kind === "static") {
      const edgeId = `calls-static:${callerId}:${outcome.targetId}:${callSiteId}`;
      this.edges.set(edgeId, {
        id: edgeId,
        kind: "CALLS_STATIC",
        from: callerId,
        to: outcome.targetId,
        confidence: STATIC_CONFIDENCE,
        ref: `${ctx.rel}:${line}`,
        callSite: callSiteId
      });
    } else {
      const edgeId = `calls-unresolved:${callerId}:${callSiteId}`;
      this.edges.set(edgeId, {
        id: edgeId,
        kind: "CALLS_UNRESOLVED",
        from: callerId,
        to: UNKNOWN,
        confidence: UNRESOLVED_CONFIDENCE,
        ref: `${ctx.rel}:${line}`,
        uncertain: true,
        callSite: callSiteId
      });
    }
  }
}
function indexFiles(entryFiles, options = {}) {
  if (entryFiles.length === 0)
    return { nodes: [], edges: [] };
  const absoluteEntries = entryFiles.map((entry) => resolve(entry));
  const root = commonDir(absoluteEntries.map(toPosixPath));
  const tsserverPath = options.tsserverPath ?? defaultTsServerPath();
  const api = new API({ tsserverPath, cwd: root });
  try {
    const snapshot = api.updateSnapshot({ openFiles: absoluteEntries });
    try {
      const builder = new GraphBuilder(root);
      const byProject = new Map;
      for (const entry of absoluteEntries) {
        const project = snapshot.getDefaultProjectForFile(entry);
        if (!project)
          throw new Error(`code-graph: no TypeScript project covers entry: ${entry}`);
        const list = byProject.get(project);
        if (list)
          list.push(entry);
        else
          byProject.set(project, [entry]);
      }
      for (const [project, entries] of byProject)
        builder.addEntries(project, entries);
      builder.addKnowledgeLinks(options.knowledge ?? []);
      return { ...builder.snapshot(), root };
    } finally {
      snapshot.dispose();
    }
  } finally {
    api.close();
  }
}
// ../../../../omo-engine/code-graph/src/queries.ts
var DEFAULT_RESULT_LIMIT = 20;
var MAX_RESULT_LIMIT = 50;
var DEFAULT_MAX_DEPTH = 5;
var MAX_DEPTH_LIMIT = 10;
var SUPPORTED_FILE = /\.[cm]?[tj]sx?$/;
function clampLimit(limit) {
  if (limit === undefined || !Number.isFinite(limit))
    return DEFAULT_RESULT_LIMIT;
  return Math.min(MAX_RESULT_LIMIT, Math.max(1, Math.floor(limit)));
}
function clampDepth(depth) {
  if (depth === undefined || !Number.isFinite(depth))
    return DEFAULT_MAX_DEPTH;
  return Math.min(MAX_DEPTH_LIMIT, Math.max(1, Math.floor(depth)));
}
function scopeFromBaseline(baseline) {
  return {
    projectId: baseline.scope.projectId,
    worktreeId: baseline.scope.worktreeId,
    revision: baseline.scope.revision,
    fingerprint: baseline.scope.fingerprint
  };
}
function resolveScope(options) {
  if (options.baseline !== undefined)
    return scopeFromBaseline(options.baseline);
  return options.scope;
}
function baseEnvelope(scope, freshness) {
  return {
    projectId: scope.projectId,
    worktreeId: scope.worktreeId,
    revision: scope.revision,
    fingerprint: scope.fingerprint,
    freshness
  };
}
function isSupportedPath(path) {
  const base = path.split("/").pop() ?? path;
  if (!base.includes("."))
    return false;
  return SUPPORTED_FILE.test(base);
}
function unsupportedNote(path) {
  return `unsupported file type: ${path} is unindexed (never analyzed)`;
}
function symbolFilePart(symbolId) {
  const at = symbolId.lastIndexOf("@");
  if (at < 0)
    return;
  return symbolId.slice(at + 1);
}
function indexedEvidence(node) {
  return { edge: "indexed", ref: `${node.file}:${node.line}`, confidence: 1 };
}
function knowledgeIdsFor(snapshot, nodeIds) {
  const byNode = new Map;
  const knowledgeTargets = new Map;
  for (const node of snapshot.nodes) {
    if (node.kind === "knowledge-link" && node.target !== undefined) {
      knowledgeTargets.set(node.id, node.target);
    }
  }
  for (const edge of snapshot.edges) {
    if (edge.kind !== "LINKS_KNOWLEDGE")
      continue;
    if (!nodeIds.has(edge.from))
      continue;
    const recordId = knowledgeTargets.get(edge.to);
    if (recordId === undefined)
      continue;
    const list = byNode.get(edge.from);
    if (list) {
      if (!list.includes(recordId))
        list.push(recordId);
    } else {
      byNode.set(edge.from, [recordId]);
    }
  }
  return byNode;
}
function unionKnowledge(linked) {
  const out = [];
  for (const ids of linked.values()) {
    for (const id of ids) {
      if (!out.includes(id))
        out.push(id);
    }
  }
  return out;
}
function toItem(node, evidence, knowledge) {
  const item = {
    id: node.id,
    file: node.file,
    line: node.line,
    evidence,
    confidence: 1,
    knowledgeIds: knowledge
  };
  return node.name === undefined ? item : { ...item, name: node.name };
}
function nodeItem(snapshot, node, evidence) {
  const linked = knowledgeIdsFor(snapshot, new Set([node.id, `file:${node.file}`]));
  const own = [...linked.get(node.id) ?? [], ...linked.get(`file:${node.file}`) ?? []].filter((id, index, all) => all.indexOf(id) === index);
  return toItem(node, evidence.length > 0 ? evidence : [indexedEvidence(node)], own);
}
function unresolvedFor(snapshot, symbolId) {
  return snapshot.edges.filter((edge) => edge.kind === "CALLS_UNRESOLVED" && edge.from === symbolId).map((edge) => `${edge.ref} calls an unknown callee (manual review, never proven)`).sort();
}
function search(snapshot, query, options) {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const needle = query.toLowerCase();
  if ((query.includes("/") || query.includes("\\")) && !isSupportedPath(query)) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(query)],
      items: []
    };
  }
  const ranked = [];
  for (const node of snapshot.nodes) {
    if (node.kind !== "file" && node.kind !== "symbol")
      continue;
    const id = node.id.toLowerCase();
    const name = (node.name ?? "").toLowerCase();
    const file = node.file.toLowerCase();
    let rank = -1;
    if (id === needle || name === needle)
      rank = 0;
    else if (name.startsWith(needle))
      rank = 1;
    else if (name.includes(needle))
      rank = 2;
    else if (file.includes(needle))
      rank = 3;
    else if (id.includes(needle))
      rank = 4;
    if (rank >= 0)
      ranked.push({ node, rank });
  }
  ranked.sort((left, right) => rankCompare(left, right));
  const truncated = ranked.length > limit;
  const items = ranked.slice(0, limit).map(({ node }) => nodeItem(snapshot, node, definesEvidence(snapshot, node)));
  const notes = truncated ? [`truncated to ${limit} of ${ranked.length} matches`] : [];
  return {
    ...baseEnvelope(scope, freshness),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved: notes,
    unsupported: [],
    items
  };
}
function rankCompare(left, right) {
  if (left.rank !== right.rank)
    return left.rank - right.rank;
  return left.node.id < right.node.id ? -1 : 1;
}
function definesEvidence(snapshot, node) {
  if (node.kind === "file")
    return [indexedEvidence(node)];
  const evidence = snapshot.edges.filter((edge) => edge.kind === "DEFINES" && edge.to === node.id).map((edge) => ({ edge: edge.kind, ref: edge.ref, confidence: edge.confidence }));
  return evidence.length > 0 ? evidence : [indexedEvidence(node)];
}
function findNode(snapshot, id) {
  return snapshot.nodes.find((node) => node.id === id);
}
function callersOf(snapshot, symbolId) {
  const out = [];
  for (const edge of snapshot.edges) {
    if (edge.kind !== "CALLS_STATIC" || edge.to !== symbolId)
      continue;
    const caller = findNode(snapshot, edge.from);
    if (caller !== undefined)
      out.push({ caller, ref: edge.ref });
  }
  out.sort((left, right) => left.caller.id < right.caller.id ? -1 : 1);
  return out;
}
function calleesOf(snapshot, symbolId) {
  const out = [];
  for (const edge of snapshot.edges) {
    if (edge.kind !== "CALLS_STATIC" || edge.from !== symbolId)
      continue;
    const callee = findNode(snapshot, edge.to);
    if (callee !== undefined)
      out.push({ callee, ref: edge.ref });
  }
  out.sort((left, right) => left.callee.id < right.callee.id ? -1 : 1);
  return out;
}
function unindexedSymbol(scope, freshness, symbolId) {
  const filePart = symbolFilePart(symbolId);
  const unsupported = filePart !== undefined && !isSupportedPath(filePart) ? [unsupportedNote(filePart)] : [];
  return {
    ...baseEnvelope(scope, freshness),
    coverage: "unindexed",
    truncated: false,
    knowledgeIds: [],
    unresolved: [`no definition for ${symbolId} in this snapshot`],
    unsupported,
    items: [],
    definition: undefined,
    callers: [],
    callees: []
  };
}
function symbolContext(snapshot, symbolId, options) {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const filePart = symbolFilePart(symbolId);
  if (filePart !== undefined && !isSupportedPath(filePart)) {
    const empty = {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(filePart)],
      items: [],
      definition: undefined,
      callers: [],
      callees: []
    };
    return empty;
  }
  const node = findNode(snapshot, symbolId);
  if (node === undefined || node.kind !== "symbol") {
    return unindexedSymbol(scope, freshness, symbolId);
  }
  const definition = nodeItem(snapshot, node, definesEvidence(snapshot, node));
  const callerItems = callersOf(snapshot, symbolId).map(({ caller, ref }) => nodeItem(snapshot, caller, [{ edge: "CALLS_STATIC", ref, confidence: 1 }]));
  const calleeItems = calleesOf(snapshot, symbolId).map(({ callee, ref }) => nodeItem(snapshot, callee, [{ edge: "CALLS_STATIC", ref, confidence: 1 }]));
  const combined = [definition, ...callerItems, ...calleeItems];
  const truncated = combined.length > limit;
  const items = combined.slice(0, limit);
  return {
    ...baseEnvelope(scope, freshness),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved: [
      ...unresolvedFor(snapshot, symbolId),
      ...truncated ? [`truncated to ${limit} of ${combined.length} rows`] : []
    ],
    unsupported: [],
    items,
    definition,
    callers: callerItems.slice(0, limit),
    callees: calleeItems.slice(0, limit)
  };
}
function impact(snapshot, symbolId, options) {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const maxDepth = clampDepth(options.maxDepth);
  const filePart = symbolFilePart(symbolId);
  if (filePart !== undefined && !isSupportedPath(filePart)) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [],
      unsupported: [unsupportedNote(filePart)],
      items: [],
      subject: undefined,
      impacted: []
    };
  }
  const subjectNode = findNode(snapshot, symbolId);
  if (subjectNode === undefined) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`no definition for ${symbolId} in this snapshot`],
      unsupported: [],
      items: [],
      subject: undefined,
      impacted: []
    };
  }
  const subject = nodeItem(snapshot, subjectNode, definesEvidence(snapshot, subjectNode));
  const impacted = [];
  const seen = new Set([symbolId]);
  let frontier = [symbolId];
  let truncated = false;
  for (let depth = 0;depth < maxDepth && frontier.length > 0 && !truncated; depth += 1) {
    const next = [];
    for (const current of frontier) {
      for (const { caller, ref } of callersOf(snapshot, current)) {
        if (seen.has(caller.id))
          continue;
        seen.add(caller.id);
        if (impacted.length >= limit) {
          truncated = true;
          break;
        }
        impacted.push(nodeItem(snapshot, caller, [{ edge: "CALLS_STATIC", ref, confidence: 1 }]));
        if (caller.kind === "symbol")
          next.push(caller.id);
      }
      if (truncated)
        break;
    }
    frontier = next;
  }
  const unresolved = [
    ...unresolvedFor(snapshot, symbolId),
    ...truncated ? [`truncated to ${limit} impacted rows`] : []
  ];
  return {
    ...baseEnvelope(scope, freshness),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(impacted.map((item) => item.id)))),
    unresolved,
    unsupported: [],
    items: impacted,
    subject,
    impacted
  };
}
function trace(snapshot, fromId, toId, options) {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const maxDepth = clampDepth(options.maxDepth);
  for (const id of [fromId, toId]) {
    const filePart = symbolFilePart(id);
    if (filePart !== undefined && !isSupportedPath(filePart)) {
      return {
        ...baseEnvelope(scope, freshness),
        coverage: "unindexed",
        truncated: false,
        knowledgeIds: [],
        unresolved: [],
        unsupported: [unsupportedNote(filePart)],
        items: [],
        path: []
      };
    }
  }
  const fromNode = findNode(snapshot, fromId);
  const toNode = findNode(snapshot, toId);
  if (fromNode === undefined || toNode === undefined) {
    const missing = fromNode === undefined ? fromId : toId;
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`no definition for ${missing} in this snapshot`],
      unsupported: [],
      items: [],
      path: []
    };
  }
  if (fromId === toId) {
    const self = nodeItem(snapshot, fromNode, [indexedEvidence(fromNode)]);
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "indexed",
      truncated: false,
      knowledgeIds: [...self.knowledgeIds],
      unresolved: [],
      unsupported: [],
      items: [self],
      path: []
    };
  }
  const parents = new Map;
  const seen = new Set([fromId]);
  const visitCap = limit * 20;
  let frontier = [fromId];
  let found = false;
  let abandoned = false;
  for (let depth = 0;depth < maxDepth && frontier.length > 0 && !found && !abandoned; depth += 1) {
    const next = [];
    for (const current of frontier) {
      for (const { callee, ref } of calleesOf(snapshot, current)) {
        if (seen.has(callee.id))
          continue;
        seen.add(callee.id);
        parents.set(callee.id, { via: current, ref });
        if (callee.id === toId) {
          found = true;
          break;
        }
        next.push(callee.id);
        if (seen.size > visitCap) {
          abandoned = true;
          break;
        }
      }
      if (found || abandoned)
        break;
    }
    frontier = next;
  }
  if (abandoned && !found) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "partial",
      truncated: true,
      knowledgeIds: [],
      unresolved: [`trace abandoned: call frontier exceeded ${visitCap} nodes (bounded, never the whole graph)`],
      unsupported: [],
      items: [],
      path: []
    };
  }
  if (!found) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "indexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`no static call path from ${fromId} to ${toId} (never guessed)`],
      unsupported: [],
      items: [],
      path: []
    };
  }
  const chain = [toId];
  while (chain[0] !== fromId) {
    const head = chain[0];
    const parent = parents.get(head);
    if (parent === undefined)
      break;
    chain.unshift(parent.via);
  }
  const path = [];
  for (let index = 0;index < chain.length - 1; index += 1) {
    const child = chain[index + 1];
    const parent = parents.get(child);
    path.push({ from: chain[index], to: child, ref: parent?.ref ?? "", confidence: 1 });
  }
  const items = chain.map((id) => findNode(snapshot, id)).filter((node) => node !== undefined).map((node) => {
    const step = path.find((entry) => entry.from === node.id || entry.to === node.id);
    return nodeItem(snapshot, node, step ? [{ edge: "CALLS_STATIC", ref: step.ref, confidence: 1 }] : [indexedEvidence(node)]);
  });
  return {
    ...baseEnvelope(scope, freshness),
    coverage: "indexed",
    truncated: false,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(items.map((item) => item.id)))),
    unresolved: unresolvedFor(snapshot, fromId),
    unsupported: [],
    items,
    path
  };
}
function subjectFileFor(snapshot, target) {
  if (!target.includes("@") && !target.startsWith("fn:") && !target.startsWith("class:") && !target.startsWith("const:")) {
    return target;
  }
  const node = findNode(snapshot, target);
  if (node !== undefined)
    return node.file;
  const filePart = symbolFilePart(target);
  return filePart;
}
function findTests(snapshot, target, options) {
  const scope = resolveScope(options);
  const freshness = options.freshness ?? "fresh";
  const limit = clampLimit(options.limit);
  const maxDepth = clampDepth(options.maxDepth);
  const subjectFile = subjectFileFor(snapshot, target);
  if (subjectFile === undefined || !isSupportedPath(subjectFile)) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: subjectFile === undefined ? [`no definition for ${target} in this snapshot`] : [],
      unsupported: subjectFile === undefined ? [] : [unsupportedNote(subjectFile)],
      items: [],
      subjectFile: undefined,
      candidates: []
    };
  }
  const subjectId = `file:${subjectFile}`;
  if (findNode(snapshot, subjectId) === undefined) {
    return {
      ...baseEnvelope(scope, freshness),
      coverage: "unindexed",
      truncated: false,
      knowledgeIds: [],
      unresolved: [`${subjectFile} is not in this snapshot`],
      unsupported: [],
      items: [],
      subjectFile: undefined,
      candidates: []
    };
  }
  const candidates = [];
  const seen = new Set([subjectId]);
  const visitCap = limit * 20;
  let frontier = [{ id: subjectId, via: [] }];
  let truncated = false;
  for (let depth = 0;depth < maxDepth && frontier.length > 0 && !truncated; depth += 1) {
    const next = [];
    for (const current of frontier) {
      for (const edge of snapshot.edges) {
        if (edge.to !== current.id)
          continue;
        if (edge.kind !== "IMPORTS" && edge.kind !== "TESTS")
          continue;
        const importer = findNode(snapshot, edge.from);
        if (importer === undefined || seen.has(importer.id))
          continue;
        seen.add(importer.id);
        if (seen.size > visitCap) {
          truncated = true;
          break;
        }
        const hop = { edge: edge.kind, ref: edge.ref, confidence: edge.confidence };
        const evidence = [...current.via, hop];
        if (importer.kind === "file" && importer.isTest === true) {
          if (candidates.length >= limit) {
            truncated = true;
            break;
          }
          candidates.push(nodeItem(snapshot, importer, evidence));
        } else if (importer.kind === "file") {
          next.push({ id: importer.id, via: evidence });
        }
      }
      if (truncated)
        break;
    }
    frontier = next;
  }
  candidates.sort((left, right) => left.id < right.id ? -1 : 1);
  return {
    ...baseEnvelope(scope, freshness),
    coverage: truncated ? "partial" : "indexed",
    truncated,
    knowledgeIds: unionKnowledge(knowledgeIdsFor(snapshot, new Set(candidates.map((item) => item.id)))),
    unresolved: truncated ? [`truncated to ${limit} candidate tests`] : [],
    unsupported: [],
    items: candidates,
    subjectFile,
    candidates
  };
}
// ../../../../omo-engine/code-graph/src/schema.ts
import { createHash } from "node:crypto";
var STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function computeScopeFingerprint(projectId, worktreeId, revision) {
  return sha256Hex(`${projectId}
${worktreeId}
${revision}`);
}
export {
  STALE_AFTER_MS,
  computeScopeFingerprint,
  findTests,
  impact,
  indexFiles,
  search,
  symbolContext,
  trace
};
