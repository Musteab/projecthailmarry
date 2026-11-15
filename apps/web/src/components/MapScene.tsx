import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, ComponentRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  useCells,
  useFacilityStates,
  useGridSections,
  useIncidents,
  useOperation,
  useRoadStates,
  useUnits,
  useHazards,
  simTimeNow,
  unitPositionAt,
} from '@bastion/client';
import type { AccessImpact, Clock, LngLat, Unit } from '@bastion/shared';
import { project, type LocalRegion, type Surface } from '../data/regions';

export type Selection = {
  type: 'incident' | 'unit' | 'facility' | 'road' | 'grid' | 'action';
  id: string;
} | null;
export type Layers = {
  buildings: boolean;
  hazard: boolean;
  units: boolean;
  grid: boolean;
  labels: boolean;
};
export type CameraRequest = { position: LngLat; ticket: number } | null;
type Props = {
  data: LocalRegion;
  layers: Layers;
  selection: Selection;
  select: (s: Selection) => void;
  focus: CameraRequest;
  overview: number;
  flat: boolean;
  accessImpact?: AccessImpact | null;
  accessMode?: 'before' | 'after';
};
const colors = { amber: '#f4bb67', green: '#92d8bc', red: '#ff785f', road: '#929d98' };
function polygonGeometry(data: LocalRegion, polygon: LngLat[], height = 0) {
  const points = polygon.map((p) => {
    const [x, , z] = project(data, p);
    return new THREE.Vector2(x, -z);
  });
  const shape = new THREE.Shape(points);
  const geo =
    height > 0
      ? new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 })
      : new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}
function combined(data: LocalRegion, surfaces: Surface[], kind: string) {
  const geometries = surfaces
    .filter((s) => s.kind === kind && s.polygon.length >= 3)
    .map((s, index) => {
      const raw = polygonGeometry(
        data,
        s.polygon,
        kind === 'building' ? Math.max(0.7, s.height / 10) : 0,
      );
      const geo = raw.index ? raw.toNonIndexed() : raw;
      if (raw !== geo) raw.dispose();
      const color = new THREE.Color(
        kind === 'building'
          ? s.landmark
            ? '#b9c9bb'
            : ['#788b83', '#91a096', '#a8b1a4', '#697e76'][index % 4]
          : kind === 'water'
            ? '#4e7f79'
            : '#526c51',
      );
      const array = new Float32Array(geo.getAttribute('position').count * 3);
      for (let i = 0; i < array.length; i += 3) color.toArray(array, i);
      geo.setAttribute('color', new THREE.BufferAttribute(array, 3));
      return geo;
    });
  if (!geometries.length) return new THREE.BufferGeometry();
  const result = mergeGeometries(geometries)!;
  geometries.forEach((g) => g.dispose());
  return result;
}
function roadGeometry(data: LocalRegion) {
  const vertices: number[] = [];
  for (const edge of data.region.edges) {
    const width =
      edge.class === 'motorway'
        ? 1.4
        : edge.class === 'arterial'
          ? 1
          : edge.class === 'collector'
            ? 0.7
            : 0.45;
    for (let i = 1; i < edge.geometry.length; i++) {
      const [ax, , az] = project(data, edge.geometry[i - 1]),
        [bx, , bz] = project(data, edge.geometry[i]);
      const length = Math.hypot(bx - ax, bz - az),
        nx = (-(bz - az) / length) * width,
        nz = ((bx - ax) / length) * width;
      const a = [ax + nx, 0.12, az + nz],
        b = [ax - nx, 0.12, az - nz],
        c = [bx + nx, 0.12, bz + nz],
        d = [bx - nx, 0.12, bz - nz];
      vertices.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.computeVertexNormals();
  return geo;
}
function City({ data, visible }: { data: LocalRegion; visible: boolean }) {
  const buildings = useMemo(() => combined(data, data.surfaces, 'building'), [data]);
  const water = useMemo(() => combined(data, data.surfaces, 'water'), [data]);
  const parks = useMemo(() => combined(data, data.surfaces, 'park'), [data]);
  const roads = useMemo(() => roadGeometry(data), [data]);
  useEffect(
    () => () => {
      buildings.dispose();
      water.dispose();
      parks.dispose();
      roads.dispose();
    },
    [buildings, water, parks, roads],
  );
  const b = data.region.config.bbox,
    west = project(data, [b[0], b[1]])[0],
    east = project(data, [b[2], b[3]])[0],
    south = project(data, [b[0], b[1]])[2],
    north = project(data, [b[2], b[3]])[2];
  return (
    <group>
      <mesh position={[(west + east) / 2, -2.5, (north + south) / 2]} receiveShadow>
        <boxGeometry args={[east - west + 12, 5, south - north + 12]} />
        <meshStandardMaterial color="#263630" roughness={0.9} />
      </mesh>
      <gridHelper args={[600, 60, '#34443e', '#273a32']} position={[0, -0.01, 0]} />
      <mesh geometry={parks} position={[0, 0.07, 0]}>
        <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={water} position={[0, 0.09, 0]}>
        <meshStandardMaterial
          vertexColors
          roughness={0.25}
          metalness={0.35}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={roads}>
        <meshStandardMaterial color="#adb7a6" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {visible && (
        <mesh geometry={buildings} castShadow receiveShadow>
          <meshStandardMaterial vertexColors roughness={0.82} metalness={0.08} />
        </mesh>
      )}
      {visible && data.region.config.id === 'sunway' && <Pyramid data={data} />}
    </group>
  );
}
function Pyramid({ data }: { data: LocalRegion }) {
  const landmark = data.landmarks.find((l) => l.name === 'Sunway Pyramid');
  if (!landmark) return null;
  const p = project(data, landmark.position);
  // Recognisable stylised landmark; not a surveyed architectural reconstruction.
  return (
    <group position={[p[0], 1.8, p[2]]}>
      <mesh position={[0, 5.5, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[7.8, 11, 4]} />
        <meshStandardMaterial color="#d8bb83" roughness={0.8} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[0, i * 1.8 + 0.4, 0]} rotation={[0, Math.PI / 4, 0]}>
          <cylinderGeometry args={[7.7 - i * 1.2, 7.7 - i * 1.2, 0.16, 4]} />
          <meshStandardMaterial color="#ead2a2" />
        </mesh>
      ))}
    </group>
  );
}
function HazardLayer({ data }: { data: LocalRegion }) {
  const cells = useCells();
  const meshes = useMemo(
    () =>
      Object.entries(cells).flatMap(([id, state]) => {
        const polygon = data.cellPolygons[id];
        if (!polygon) return [];
        const depth = state.floodDepthM ?? 0,
          quake = state.shakeMMI ?? 0;
        if (depth < 0.05 && quake < 1) return [];
        return [{ id, geometry: polygonGeometry(data, polygon), depth, quake }];
      }),
    [data, cells],
  );
  useEffect(() => () => meshes.forEach((m) => m.geometry.dispose()), [meshes]);
  return (
    <group>
      {meshes.map((m) => (
        <mesh
          key={m.id}
          geometry={m.geometry}
          position={[0, 0.28 + m.depth * 0.45, 0]}
          renderOrder={3}
        >
          <meshBasicMaterial
            color={m.quake ? '#e6a269' : '#71c6b1'}
            transparent
            opacity={m.quake ? 0.12 + m.quake / 35 : 0.18 + Math.min(0.27, m.depth / 8)}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
function Vehicle({
  unit,
  clock,
  data,
  select,
  selected,
}: {
  unit: Unit;
  clock: Clock;
  data: LocalRegion;
  select: Props['select'];
  selected: boolean;
}) {
  const ref = useRef<THREE.Group>(null);
  const color = unit.kind.includes('ambulance')
    ? '#ede9db'
    : unit.kind === 'public_works'
      ? '#f1bf65'
      : '#e68c6d';
  useFrame(() => {
    if (!ref.current) return;
    const pose = unitPositionAt(unit, clock, Date.now()),
      p = project(data, pose.position);
    ref.current.position.set(p[0], 1.3, p[2]);
    ref.current.rotation.y = (-pose.heading * Math.PI) / 180;
  });
  return (
    <group
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        select({ type: 'unit', id: unit.id });
      }}
    >
      <mesh castShadow>
        <boxGeometry args={[1.5, 1.3, 3]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 0.85, -0.65]}>
        <boxGeometry args={[1.35, 0.65, 1.4]} />
        <meshStandardMaterial color="#d8e2d8" />
      </mesh>
      <mesh position={[0, 0.85, -1.37]}>
        <boxGeometry args={[1.15, 0.45, 0.08]} />
        <meshStandardMaterial color="#254e52" />
      </mesh>
      <mesh position={[0, 1.25, -0.6]}>
        <boxGeometry args={[0.9, 0.22, 0.3]} />
        <meshBasicMaterial color={unit.status === 'available' ? '#8eb0a0' : '#ff7258'} />
      </mesh>
      {[-0.8, 0.8].flatMap((x) =>
        [-0.9, 0.9].map((z) => (
          <mesh key={`${x}${z}`} position={[x, -0.55, z]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.37, 0.37, 0.22, 8]} />
            <meshStandardMaterial color="#19211f" />
          </mesh>
        )),
      )}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]}>
          <ringGeometry args={[2.5, 2.7, 48]} />
          <meshBasicMaterial color={colors.amber} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
function Dynamics({ data, layers, select, selection }: Props) {
  const units = useUnits(),
    incidents = useIncidents(),
    roads = useRoadStates(),
    grid = useGridSections(),
    { clock } = useOperation();
  return (
    <group>
      {layers.hazard && <HazardLayer data={data} />}
      {Object.entries(roads)
        .filter(([, s]) => s.status !== 'open')
        .map(([id]) => {
          const e = data.region.edges.find((r) => r.id === id);
          return (
            e && (
              <Line
                key={id}
                points={e.geometry.map((p) => {
                  const v = project(data, p);
                  v[1] = 1.1;
                  return v;
                })}
                color={colors.red}
                lineWidth={5}
                onClick={(event) => {
                  event.stopPropagation();
                  select({ type: 'road', id });
                }}
              />
            )
          );
        })}
      {layers.grid &&
        data.region.grid.sections.map((s) => (
          <Line
            key={s.id}
            points={s.path.map((p) => {
              const v = project(data, p);
              v[1] = 3;
              return v;
            })}
            color={grid[s.id]?.status === 'energized' ? colors.amber : '#ff785f'}
            dashed
            dashSize={2}
            gapSize={1}
            lineWidth={2}
            onClick={(e) => {
              e.stopPropagation();
              select({ type: 'grid', id: s.id });
            }}
          />
        ))}
      {layers.units &&
        clock &&
        units.map((unit) => (
          <group key={unit.id}>
            {unit.assignment && unit.assignment.route.length > 1 && (
              <Line
                points={unit.assignment.route.map((p) => {
                  const v = project(data, p);
                  v[1] = 1;
                  return v;
                })}
                color={unit.kind.includes('ambulance') ? '#d5efe4' : colors.amber}
                lineWidth={selection?.id === unit.id ? 4 : 2}
                transparent
                opacity={0.8}
              />
            )}
            <Vehicle
              unit={unit}
              clock={clock}
              data={data}
              select={select}
              selected={selection?.id === unit.id}
            />
          </group>
        ))}
      {incidents
        .filter((i) => !['resolved', 'closed'].includes(i.status))
        .map((incident) => {
          const p = project(data, incident.position);
          return (
            <group key={incident.id} position={[p[0], 1.5, p[2]]}>
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                onClick={(e) => {
                  e.stopPropagation();
                  select({ type: 'incident', id: incident.id });
                }}
              >
                <ringGeometry args={[3, 3.5, 48]} />
                <meshBasicMaterial color={colors.red} side={THREE.DoubleSide} />
              </mesh>
            </group>
          );
        })}
    </group>
  );
}
type MarkerRefs = Map<string, HTMLDivElement>;
function Markers({ data, layers, select, selection, markers }: Props & { markers: MarkerRefs }) {
  const units = useUnits(),
    incidents = useIncidents(),
    facilities = useFacilityStates();
  const wrapper = (id: string, child: ReactNode) => (
    <div
      className="projected-marker"
      key={id}
      ref={(el) => {
        if (el) markers.set(id, el);
        else markers.delete(id);
      }}
    >
      {child}
    </div>
  );
  return (
    <div className="marker-overlay">
      {layers.units &&
        units.map((u) =>
          wrapper(
            u.id,
            <button
              className={`map-unit ${selection?.id === u.id ? 'selected' : ''}`}
              onClick={() => select({ type: 'unit', id: u.id })}
            >
              {u.callsign}
            </button>,
          ),
        )}
      {incidents
        .filter((i) => !['resolved', 'closed'].includes(i.status))
        .map((i) =>
          wrapper(
            i.id,
            <button className="map-incident" onClick={() => select({ type: 'incident', id: i.id })}>
              <span className="pulse-dot" />
              {i.kind === 'medical' ? '+' : '!'}
              <span>
                {i.peopleAffected} {i.kind === 'medical' ? 'PATIENT' : 'AT RISK'}
              </span>
            </button>,
          ),
        )}
      {data.region.facilities
        .filter(
          (f) =>
            (layers.labels && ['hospital', 'shelter'].includes(f.kind)) || selection?.id === f.id,
        )
        .map((f) =>
          wrapper(
            f.id,
            <button
              className={`map-facility ${facilities[f.id]?.power !== 'grid' ? 'backup' : ''}`}
              onClick={() => select({ type: 'facility', id: f.id })}
            >
              <b>{f.kind === 'hospital' ? '+' : '⌂'}</b>
              <span>
                {f.name.replace(' · exercise shelter', '').replace(' · exercise assembly', '')}
              </span>
            </button>,
          ),
        )}
    </div>
  );
}
function ProjectMarkers({ data, markers }: { data: LocalRegion; markers: MarkerRefs }) {
  const units = useUnits(),
    incidents = useIncidents(),
    { clock } = useOperation(),
    vector = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    const position = (id: string, p: LngLat, height: number) => {
      const el = markers.get(id);
      if (!el) return;
      const world = project(data, p);
      vector.set(world[0], height, world[2]).project(camera);
      el.style.visibility =
        vector.z > 1 || Math.abs(vector.x) > 1.05 || Math.abs(vector.y) > 1.05
          ? 'hidden'
          : 'visible';
      el.style.transform = `translate(${(vector.x * 0.5 + 0.5) * size.width}px,${(-vector.y * 0.5 + 0.5) * size.height}px) translate(-50%,-50%)`;
    };
    for (const u of units)
      position(u.id, clock ? unitPositionAt(u, clock, Date.now()).position : u.position, 4.7);
    for (const i of incidents) position(i.id, i.position, 6.5);
    for (const f of data.region.facilities) position(f.id, f.position, 8);
  });
  return null;
}
function AccessLayer({ data, accessImpact, accessMode = 'after' }: Props) {
  const geometries = useMemo(
    () =>
      (accessImpact?.cells ?? []).flatMap((cell) => {
        const polygon = data.cellPolygons[cell.cellId];
        return polygon ? [{ cell, geometry: polygonGeometry(data, polygon) }] : [];
      }),
    [data, accessImpact],
  );
  useEffect(() => () => geometries.forEach((g) => g.geometry.dispose()), [geometries]);
  return (
    <group>
      {geometries.map(({ cell, geometry }) => {
        const value = accessMode === 'after' ? cell.afterMin : cell.beforeMin;
        return (
          <mesh key={cell.cellId} geometry={geometry} position={[0, 1, 0]} renderOrder={5}>
            <meshBasicMaterial
              color={value === null ? '#df7f66' : value <= 15 ? '#a6d39a' : '#eac877'}
              transparent
              opacity={0.25}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}
function Shockwave({ data }: { data: LocalRegion }) {
  const hazards = useHazards(),
    { clock } = useOperation(),
    ring = useRef<THREE.Mesh>(null);
  const quake = hazards.find((h) => h.kind === 'earthquake');
  useFrame(() => {
    if (!ring.current || !clock) return;
    const elapsed = simTimeNow(clock, Date.now()) - (quake?.originSimTime ?? 0);
    ring.current.visible = !!quake && elapsed < 24;
    const scale = Math.max(0.1, elapsed * 12);
    ring.current.scale.setScalar(scale);
    (ring.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 - elapsed / 35);
  });
  const p = project(data, quake?.epicenter ?? data.region.config.defaultCamera.center);
  return (
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[p[0], 2, p[2]]}>
      <ringGeometry args={[0.97, 1, 96]} />
      <meshBasicMaterial color="#efb778" transparent depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
function CameraRig({
  data,
  focus,
  overview,
  flat,
}: Pick<Props, 'data' | 'focus' | 'overview' | 'flat'>) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null),
    { camera } = useThree();
  const goal = useRef<{ eye: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  useEffect(() => {
    goal.current = {
      eye: new THREE.Vector3(flat ? 0 : 155, flat ? 340 : 205, flat ? 0.1 : 240),
      target: new THREE.Vector3(0, 0, 0),
    };
  }, [data, overview, flat]);
  useEffect(() => {
    if (focus) {
      const p = project(data, focus.position);
      goal.current = {
        eye: new THREE.Vector3(p[0] + (flat ? 0 : 70), flat ? 240 : 110, p[2] + (flat ? 0.1 : 100)),
        target: new THREE.Vector3(...p),
      };
    }
  }, [focus, data, flat]);
  useFrame((_, dt) => {
    if (!goal.current || !controls.current) return;
    const alpha = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 1
      : 1 - Math.exp(-dt * 3.5);
    camera.position.lerp(goal.current.eye, alpha);
    controls.current.target.lerp(goal.current.target, alpha);
    controls.current.update();
    if (camera.position.distanceTo(goal.current.eye) < 0.1) goal.current = null;
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={45}
      maxDistance={550}
      maxPolarAngle={Math.PI / 2.12}
      onStart={() => {
        goal.current = null;
      }}
    />
  );
}
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
function FlatFallback({ data, select }: Props) {
  const roads = data.region.edges;
  return (
    <div className="fallback-map">
      <span>2D fallback · WebGL unavailable</span>
      <svg
        viewBox="-170 -170 340 340"
        role="img"
        aria-label={`Street map of ${data.region.config.name}`}
      >
        {roads.map((e) => (
          <polyline
            key={e.id}
            points={e.geometry
              .map((p) => {
                const v = project(data, p);
                return `${v[0]},${v[2]}`;
              })
              .join(' ')}
            fill="none"
            stroke="#7d9589"
            strokeWidth=".7"
          />
        ))}
        {data.region.facilities.map((f) => {
          const p = project(data, f.position);
          return (
            <circle
              key={f.id}
              cx={p[0]}
              cy={p[2]}
              r="3"
              fill="#efbb73"
              onClick={() => select({ type: 'facility', id: f.id })}
            >
              <title>{f.name}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
}
export function MapScene(props: Props) {
  const [webgl] = useState(() => {
    try {
      const canvas = document.createElement('canvas');
      return !!canvas.getContext('webgl2');
    } catch {
      return false;
    }
  });
  const fallback = <FlatFallback {...props} />;
  const markers = useMemo<MarkerRefs>(() => new Map(), []);
  return (
    <div className="scene" aria-label={`Interactive 3D map of ${props.data.region.config.name}`}>
      <SceneBoundary fallback={fallback}>
        {webgl ? (
          <Canvas
            dpr={[1, 1.5]}
            shadows
            gl={{ antialias: true, alpha: false }}
            onPointerMissed={() => props.select(null)}
          >
            <color attach="background" args={['#14231e']} />
            <fog attach="fog" args={['#14231e', 450, 850]} />
            <PerspectiveCamera
              makeDefault
              position={[155, 205, 240]}
              fov={42}
              near={1}
              far={1400}
            />
            <ambientLight intensity={1.2} />
            <hemisphereLight args={['#f1ead0', '#273f38', 1.4]} />
            <directionalLight
              position={[-80, 180, -40]}
              intensity={3}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-200}
              shadow-camera-right={200}
              shadow-camera-top={200}
              shadow-camera-bottom={-200}
              shadow-camera-far={600}
              shadow-bias={-0.001}
            />
            <Suspense fallback={null}>
              <City data={props.data} visible={props.layers.buildings} />
              <Dynamics {...props} />
              <AccessLayer {...props} />
              <Shockwave data={props.data} />
            </Suspense>
            <ProjectMarkers data={props.data} markers={markers} />
            <CameraRig {...props} />
          </Canvas>
        ) : (
          fallback
        )}
      </SceneBoundary>
      {webgl && <Markers {...props} markers={markers} />}
    </div>
  );
}
