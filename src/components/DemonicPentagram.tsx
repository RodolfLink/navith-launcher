import React, { memo } from 'react';

const EMBERS = Array.from({ length: 20 }, (_, i) => ({
  id: i,
  left: `${(i * 5.2 + 2) % 96}%`,
  size: 2.5 + (i % 4) * 1.5,
  duration: 5.5 + (i % 5) * 1.8,
  delay: (i * 0.65) % 5.5,
  drift: (i % 2 === 0 ? 1 : -1) * (18 + (i % 3) * 12),
  opacity: 0.45 + (i % 3) * 0.25
}));

const DemonicPentagram: React.FC = () => {
  return (
    <div className="demonic-pentagram-container" aria-hidden="true">
      <div className="demonic-ambient-aura" />

      <div className="demonic-svg-wrapper">
        <svg 
          viewBox="0 0 600 600" 
          className="demonic-pentagram-svg"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="demonic-crisp-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.8" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <linearGradient id="demonic-crimson-violet" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ff1744" />
              <stop offset="50%" stopColor="#ff0055" />
              <stop offset="100%" stopColor="#d500f9" />
            </linearGradient>

            <linearGradient id="demonic-blood-grad" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#ff0055" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#b100ff" stopOpacity="0.04" />
            </linearGradient>

            <radialGradient id="demonic-core-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(255, 0, 85, 0.18)" />
              <stop offset="45%" stopColor="rgba(177, 0, 255, 0.08)" />
              <stop offset="75%" stopColor="rgba(220, 20, 60, 0.02)" />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>

          <circle cx="300" cy="300" r="275" fill="url(#demonic-core-glow)" className="demonic-pulse-core" />

          <g className="demonic-ring-cw">
            <circle cx="300" cy="300" r="280" stroke="#ff0055" strokeWidth="2" strokeOpacity="0.85" fill="none" filter="url(#demonic-crisp-glow)" />
            <circle cx="300" cy="300" r="256" stroke="#b100ff" strokeWidth="1.8" strokeOpacity="0.8" fill="none" />
            
            {[
              { char: '🜏', angle: 0 },
              { char: '⛧', angle: 22.5 },
              { char: '🜍', angle: 45 },
              { char: '🝤', angle: 67.5 },
              { char: '🜎', angle: 90 },
              { char: '🜁', angle: 112.5 },
              { char: '🜂', angle: 135 },
              { char: '🜃', angle: 157.5 },
              { char: '🜏', angle: 180 },
              { char: '⛧', angle: 202.5 },
              { char: '🜍', angle: 225 },
              { char: '🝤', angle: 247.5 },
              { char: '🜎', angle: 270 },
              { char: '🜔', angle: 292.5 },
              { char: '🜕', angle: 315 },
              { char: '🜖', angle: 337.5 }
            ].map(({ char, angle }) => {
              const rad = (angle * Math.PI) / 180;
              const x = 300 + 268 * Math.cos(rad);
              const y = 300 + 268 * Math.sin(rad);
              return (
                <text
                  key={angle}
                  x={x}
                  y={y}
                  fill="#ff2a6d"
                  fontSize="15"
                  fontWeight="900"
                  textAnchor="middle"
                  dominantBaseline="central"
                  opacity="0.95"
                  transform={`rotate(${angle + 90}, ${x}, ${y})`}
                >
                  {char}
                </text>
              );
            })}
          </g>

          <g className="demonic-ring-ccw">
            <circle cx="300" cy="300" r="238" stroke="#ff1744" strokeWidth="2" strokeDasharray="6 6" strokeOpacity="0.85" fill="none" filter="url(#demonic-crisp-glow)" />
            <circle cx="300" cy="300" r="220" stroke="#d500f9" strokeWidth="1.6" strokeOpacity="0.75" fill="none" />
            
            {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
              <line
                key={deg}
                x1={300 + 220 * Math.cos((deg * Math.PI) / 180)}
                y1={300 + 220 * Math.sin((deg * Math.PI) / 180)}
                x2={300 + 238 * Math.cos((deg * Math.PI) / 180)}
                y2={300 + 238 * Math.sin((deg * Math.PI) / 180)}
                stroke="#ff0055"
                strokeWidth="2"
                strokeOpacity="0.9"
              />
            ))}
          </g>

          <g className="demonic-star-group">
            <circle cx="300" cy="300" r="202" stroke="#ff0055" strokeWidth="2.8" strokeOpacity="0.9" fill="none" filter="url(#demonic-crisp-glow)" />
            <circle cx="300" cy="300" r="195" stroke="#b100ff" strokeWidth="1.2" strokeOpacity="0.65" fill="none" />

            <polygon
              points="300,490 188.3,146.3 480.7,358.7 119.3,358.7 411.7,146.3"
              fill="url(#demonic-blood-grad)"
              stroke="url(#demonic-crimson-violet)"
              strokeWidth="3.8"
              strokeLinejoin="miter"
              strokeMiterlimit="4"
              filter="url(#demonic-crisp-glow)"
              className="demonic-pentagram-star"
            />

            <polygon
              points="300,470 198,160 460,350 140,350 402,160"
              fill="none"
              stroke="#ff2a6d"
              strokeWidth="1.6"
              strokeOpacity="0.75"
            />

            <polygon
              points="300,375 228,322 255,240 345,240 372,322"
              fill="rgba(177, 0, 255, 0.08)"
              stroke="#d500f9"
              strokeWidth="2.2"
              strokeOpacity="0.9"
              filter="url(#demonic-crisp-glow)"
            />

            <circle cx="300" cy="300" r="74" stroke="#ff1744" strokeWidth="2" strokeDasharray="4 4" strokeOpacity="0.9" fill="none" />
            <circle cx="300" cy="300" r="66" stroke="#b100ff" strokeWidth="1" strokeOpacity="0.7" fill="none" />

            {[
              { x: 300, y: 512, char: '🜏' }, // Punta inferior
              { x: 172, y: 130, char: '⛧' }, // Cuerno izquierdo
              { x: 500, y: 368, char: '🜍' }, // Brazo derecho
              { x: 100, y: 368, char: '🝤' }, // Brazo izquierdo
              { x: 428, y: 130, char: '🜎' }  // Cuerno derecho
            ].map((sig, i) => (
              <text
                key={i}
                x={sig.x}
                y={sig.y}
                fill="#ffffff"
                stroke="#ff0055"
                strokeWidth="0.5"
                fontSize="22"
                fontWeight="900"
                textAnchor="middle"
                dominantBaseline="central"
                filter="url(#demonic-crisp-glow)"
                opacity="1"
                className="demonic-vertex-glyph"
              >
                {sig.char}
              </text>
            ))}

            <text
              x="300"
              y="300"
              fill="#ffffff"
              stroke="#ff0055"
              strokeWidth="0.75"
              fontSize="44"
              fontWeight="900"
              textAnchor="middle"
              dominantBaseline="central"
              filter="url(#demonic-crisp-glow)"
              className="demonic-center-symbol"
            >
              🜏
            </text>
          </g>
        </svg>
      </div>

      <div className="demonic-embers-field">
        {EMBERS.map(ember => (
          <span
            key={ember.id}
            className="demonic-ember-particle"
            style={{
              left: ember.left,
              width: `${ember.size}px`,
              height: `${ember.size}px`,
              animationDuration: `${ember.duration}s`,
              animationDelay: `${ember.delay}s`,
              opacity: ember.opacity,
              ['--ember-drift' as any]: `${ember.drift}px`
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default memo(DemonicPentagram);
