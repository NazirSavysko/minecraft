stopsound @a custom.shahed3.fly
stopsound @a custom.fp1.fly
stopsound @a custom.rocket.explosion
stopsound @a custom.shahed3.explosion
stopsound @a custom.fp1.explosion
execute as @s[type=!rocket:missile7] run playsound custom.rocket.explosion @a ~ ~ ~ 20.0 0.9 0.2
execute as @s[type=!rocket:missile7] run playsound custom.shahed3.explosion @a ~ ~ ~ 20.0 1.0
execute as @s[type=rocket:missile7] run playsound custom.rocket.explosion @a[r=25] ~ ~ ~ 20.0 0.9 0.2
execute as @s[type=rocket:missile7] run playsound custom.shahed3.explosion @a[r=25] ~ ~ ~ 20.0 1.0
execute as @s[type=rocket:missile7] run playsound custom.fp1.explosion @a[rm=25] ~ ~ ~ 20.0 1.0
particle minecraft:huge_explosion_emitter ~ ~ ~
particle minecraft:large_explosion ~ ~1.5 ~
particle minecraft:large_explosion ~ ~ ~
particle minecraft:large_explosion ~1 ~1 ~
particle minecraft:large_explosion ~-1 ~1 ~
particle minecraft:large_explosion ~ ~1 ~1
particle minecraft:large_explosion ~ ~1 ~-1
particle minecraft:large_explosion ~ ~2 ~
particle minecraft:knockback_roar_particle ~ ~ ~
particle rocket:explosion_flash ~ ~ ~
particle minecraft:campfire_tall_smoke_particle ~ ~0.3 ~
particle minecraft:campfire_tall_smoke_particle ~1.1 ~0.7 ~0.4
particle minecraft:campfire_tall_smoke_particle ~-1 ~0.6 ~-0.5
particle minecraft:campfire_tall_smoke_particle ~0.6 ~1 ~-1
particle minecraft:campfire_tall_smoke_particle ~-0.7 ~0.9 ~1
particle minecraft:campfire_tall_smoke_particle ~0.2 ~1.5 ~0.2
particle minecraft:campfire_tall_smoke_particle ~1.3 ~1.4 ~-1
particle minecraft:campfire_tall_smoke_particle ~-1.3 ~1.3 ~0.8
particle minecraft:campfire_tall_smoke_particle ~ ~2 ~
particle minecraft:campfire_tall_smoke_particle ~0.8 ~0.3 ~1.2
particle minecraft:campfire_tall_smoke_particle ~-0.9 ~0.3 ~-1.1
particle minecraft:campfire_tall_smoke_particle ~1.6 ~0.5 ~0.6
particle minecraft:campfire_tall_smoke_particle ~-1.6 ~0.6 ~-0.6
particle minecraft:campfire_tall_smoke_particle ~0.3 ~2.4 ~-0.3
execute as @s[type=rocket:missile7] run summon rocket:debris_fp1 ~ ~0.6 ~ 0 0 rocket:piece_0
execute as @s[type=rocket:missile7] run summon rocket:debris_fp1 ~ ~0.6 ~ 0 0 rocket:piece_1
execute as @s[type=rocket:missile7] run summon rocket:debris_fp1 ~ ~0.6 ~ 0 0 rocket:piece_2
execute as @s[type=rocket:missile7] run summon rocket:debris_fp1 ~ ~0.6 ~ 0 0 rocket:piece_3
execute as @s[type=rocket:missile7] run summon rocket:debris_fp1 ~ ~0.6 ~ 0 0 rocket:piece_4
execute as @s[type=rocket:missile7] run summon rocket:debris_fp1 ~ ~0.6 ~ 0 0 rocket:piece_5
execute as @s[type=rocket:missile4] run summon rocket:debris_gerbera ~ ~0.6 ~ 0 0 rocket:piece_0
execute as @s[type=rocket:missile4] run summon rocket:debris_gerbera ~ ~0.6 ~ 0 0 rocket:piece_1
execute as @s[type=rocket:missile4] run summon rocket:debris_gerbera ~ ~0.6 ~ 0 0 rocket:piece_2
execute as @s[type=rocket:missile4] run summon rocket:debris_gerbera ~ ~0.6 ~ 0 0 rocket:piece_3
execute as @s[type=rocket:missile4] run summon rocket:debris_gerbera ~ ~0.6 ~ 0 0 rocket:piece_4
execute as @s[type=rocket:missile4] run summon rocket:debris_gerbera ~ ~0.6 ~ 0 0 rocket:piece_5
